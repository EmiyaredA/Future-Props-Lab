"""Owner-side certification transaction and restart-safe audit delivery."""

import time
from datetime import datetime

from sqlalchemy import JSON, DateTime, String, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.capabilities.identity.errors import AccountError
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now

from .certification_client import CertificationRejected
from .project_certification import (
    CertificationResult,
    ConfirmedCertification,
    verify_certification,
)


class CertificationRecordsBase(DeclarativeBase):
    pass


class CertificationReceiptFields:
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    authority: Mapped[str | None] = mapped_column(String(8192))
    audit_event_id: Mapped[str | None] = mapped_column(String(36))
    audit_proof: Mapped[str | None] = mapped_column(String(8192))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class ProjectCertifications(PollingTaskRunner):
    runner_name = "project-certification-audit"
    poll_interval_seconds = 1

    def __init__(self, *, service, database, project, receipts, client):
        super().__init__()
        self.service, self.sessions, self.client = service, database.sessions, client
        self.project, self.receipts = project, receipts

    async def recover(self):
        # Every pending row already contains the outcome of a committed project change.
        return

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(self.receipts.owner_user_id, self.receipts.id)
                    .where(self.receipts.audit_event_id.is_(None))
                    .order_by(self.receipts.created_at)
                    .limit(50)
                )
            )
        first_error = None
        for owner, request_id in pending:
            try:
                await self.deliver(owner, request_id)
            except Exception as exc:
                first_error = first_error or exc
        if first_error is not None:
            raise first_error

    @staticmethod
    def validate_receipt(row, fingerprint):
        if row.fingerprint != fingerprint:
            raise AccountError("project_certification_receipt_conflict")
        return CertificationResult.model_validate(row.result)

    async def apply(self, token, grant):
        command, owner = grant.command, grant.actor.user_id
        request_id, fingerprint = str(command.request_id), command.fingerprint(owner)
        async with self.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(self.receipts, (owner, request_id))
            if row is not None:
                result = self.validate_receipt(row, fingerprint)
            else:
                await session.rollback()
                if grant.deadline <= time.time() or not await self.client.active(token):
                    raise CertificationRejected(401, {"code": "studio_auth_required"})
                await session.execute(text("BEGIN IMMEDIATE"))
                row = await session.get(self.receipts, (owner, request_id))
                if row is not None:
                    result = self.validate_receipt(row, fingerprint)
                else:
                    if grant.deadline <= time.time():
                        raise CertificationRejected(401, {"code": "studio_auth_required"})
                    project = await session.get(self.project, command.project_id)
                    if project is None or project.owner_user_id != owner:
                        raise AccountError("project_not_found")
                    if project.revision != command.expected_revision:
                        raise AccountError("revision_conflict", current=project)
                    # BEGIN IMMEDIATE holds the only SQLite write lock across this comparison
                    # and the project update, including the durable audit outcome.
                    project.is_official = command.is_official
                    project.revision += 1
                    project.updated_at = utc_now()
                    result = CertificationResult(
                        id=project.id, is_official=project.is_official, revision=project.revision
                    )
                    session.add(
                        self.receipts(
                            owner_user_id=owner,
                            id=request_id,
                            fingerprint=fingerprint,
                            result=result.model_dump(mode="json"),
                            authority=token,
                        )
                    )
                    await session.commit()
        proof = await self.deliver(owner, request_id)
        return ConfirmedCertification(result=result, proof=proof)

    async def deliver(self, owner, request_id):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(self.receipts, (owner, request_id))
            if row is None:
                raise ValueError("作品认证回执不存在")
            if row.audit_event_id is not None:
                return row.audit_proof
            token, fingerprint = row.authority, row.fingerprint
            result = CertificationResult.model_validate(row.result)
        grant = verify_certification(token, public_key=self.client.public_key, allow_expired=True)
        if (
            grant.actor.user_id != owner
            or str(grant.command.request_id) != request_id
            or grant.command.kind != self.service
            or grant.command.fingerprint(owner) != fingerprint
            or not result.matches(grant.command)
        ):
            raise ValueError("作品认证持久回执与授权不匹配")
        delivered = await self.client.audit(token, grant, result)
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(self.receipts, (owner, request_id))
            self.validate_receipt(row, fingerprint)
            if row.audit_event_id is None:
                row.audit_event_id = str(delivered.receipt.audit_event_id)
                row.audit_proof = delivered.proof
                row.authority = None
                await session.commit()
            return row.audit_proof
