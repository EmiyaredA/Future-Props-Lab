"""Short account-scoped transactions, CAS, and durable operation receipts."""

import asyncio
import hashlib
import json
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import load_only

from studio.runtime.database.ownership import bind_owner
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.tasks.blocking_io import run_blocking_io
from studio.runtime.time import utc_now

from ..exchange import import_document
from ..rules import apply_operations, default_document, has_formulas
from ..schemas import (
    CONVERTER,
    SpreadsheetDocument,
    SpreadsheetError,
    SpreadsheetImportPreview,
    SpreadsheetList,
    SpreadsheetProject,
    SpreadsheetSummary,
)
from .models import SpreadsheetImport, SpreadsheetReceipt, SpreadsheetWorkbook


def snapshot(row):
    return SpreadsheetProject(
        **{
            field: getattr(row, field)
            for field in (
                "id",
                "title",
                "document",
                "revision",
                "calculation",
                "created_at",
                "updated_at",
                "source_name",
            )
        }
    )


class Records:
    def __init__(self, sessions, originals):
        self.sessions, self.originals = sessions, originals

    async def probe(self):
        async with self.sessions() as session:
            await session.execute(text("SELECT 1"))

    async def recover(self):
        async with self.sessions() as session:
            session.info["allow_system_reads"] = True
            keys = set((await session.scalars(select(SpreadsheetWorkbook.source_key))).all())
            keys.update((await session.scalars(select(SpreadsheetImport.source_key))).all())
        await asyncio.to_thread(self.originals.recover, keys - {None})

    async def _load(self, session, owner, identity):
        row = await session.scalar(
            select(SpreadsheetWorkbook).where(
                SpreadsheetWorkbook.id == identity, SpreadsheetWorkbook.owner_user_id == owner
            )
        )
        if row is None:
            raise SpreadsheetError("工作簿不存在或不可访问", "not_found", 404)
        return row

    async def get(self, owner, identity):
        async with self.sessions() as session:
            bind_owner(session, owner)
            return snapshot(await self._load(session, owner, identity))

    async def list(self, owner, query, offset, limit):
        async with self.sessions() as session:
            bind_owner(session, owner)
            predicate = [SpreadsheetWorkbook.owner_user_id == owner]
            if query:
                predicate.append(SpreadsheetWorkbook.title.contains(query, autoescape=True))
            rows = await session.scalars(
                select(SpreadsheetWorkbook)
                .options(
                    load_only(
                        *(
                            getattr(SpreadsheetWorkbook, field)
                            for field in SpreadsheetSummary.model_fields
                        )
                    )
                )
                .where(*predicate)
                .order_by(SpreadsheetWorkbook.updated_at.desc())
                .offset(offset)
                .limit(limit)
            )
            total = await session.scalar(
                select(func.count()).select_from(SpreadsheetWorkbook).where(*predicate)
            )
            return SpreadsheetList(
                items=[
                    SpreadsheetSummary(
                        **{field: getattr(row, field) for field in SpreadsheetSummary.model_fields}
                    )
                    for row in rows
                ],
                total=total,
            )

    async def _command(self, owner, resource, body, action):
        raw = body.model_dump(mode="json") if hasattr(body, "model_dump") else body
        request_id = raw["request_id"]
        fingerprint = hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()
        async with self.sessions() as session:
            bind_owner(session, owner)

            async def replay():
                receipt = await session.get(SpreadsheetReceipt, (owner, resource, request_id))
                if receipt:
                    if receipt.fingerprint != fingerprint:
                        raise SpreadsheetError(
                            "同一 request_id 不能用于不同操作", "idempotency_conflict", 409
                        )
                    return receipt.result
                return None

            saved = await replay()
            if saved is not None:
                return saved
            try:
                result = await action(session)
                result = result.model_dump(mode="json") if hasattr(result, "model_dump") else result
                session.add(
                    SpreadsheetReceipt(
                        owner_user_id=owner,
                        resource_id=resource,
                        request_id=request_id,
                        fingerprint=fingerprint,
                        result=result,
                    )
                )
                await session.commit()
                return result
            except (RevisionConflictError, IntegrityError, SpreadsheetError):
                await session.rollback()
                saved = await replay()
                if saved is not None:
                    return saved
                raise

    async def create(self, owner, body):
        async def action(session):
            return await self._create(
                session, owner, body.title, body.document or default_document()
            )

        return SpreadsheetProject.model_validate(await self._command(owner, "create", body, action))

    async def _create(self, session, owner, title, document, source_key=None, source_name=None):
        now = utc_now().isoformat()
        row = SpreadsheetWorkbook(
            id=str(uuid4()),
            owner_user_id=owner,
            title=title,
            document=document.model_dump(mode="json"),
            revision=0,
            calculation="pending" if has_formulas(document) else "not_needed",
            created_at=now,
            updated_at=now,
            source_key=source_key,
            source_name=source_name,
        )
        session.add(row)
        await session.flush()
        return snapshot(row)

    async def _save(self, session, owner, identity, revision, title, document, calculated=False):
        current = snapshot(await self._load(session, owner, identity))
        if current.revision != revision:
            raise RevisionConflictError(revision, current.revision, current.model_dump(mode="json"))
        result = await session.execute(
            update(SpreadsheetWorkbook)
            .where(
                SpreadsheetWorkbook.id == identity,
                SpreadsheetWorkbook.owner_user_id == owner,
                SpreadsheetWorkbook.revision == revision,
            )
            .values(
                title=title,
                document=document.model_dump(mode="json"),
                revision=revision + 1,
                updated_at=utc_now().isoformat(),
                calculation=("browser_calculated" if calculated else "pending")
                if has_formulas(document)
                else "not_needed",
            )
        )
        if result.rowcount != 1:
            await session.rollback()
            actual = await self.get(owner, identity)
            raise RevisionConflictError(revision, actual.revision, actual.model_dump(mode="json"))
        session.expire_all()
        return snapshot(await self._load(session, owner, identity))

    async def put(self, owner, identity, body):
        async def action(session):
            return await self._save(
                session,
                owner,
                identity,
                body.expected_revision,
                body.title,
                body.document,
                body.calculated,
            )

        return SpreadsheetProject.model_validate(await self._command(owner, identity, body, action))

    async def operations(self, owner, identity, body):
        async def action(session):
            current = snapshot(await self._load(session, owner, identity))
            document = apply_operations(current.document, body.operations)
            return await self._save(
                session, owner, identity, body.expected_revision, current.title, document
            )

        return SpreadsheetProject.model_validate(await self._command(owner, identity, body, action))

    async def delete(self, owner, identity, revision, request_id):
        async def action(session):
            row = await self._load(session, owner, identity)
            source_key = row.source_key
            current = snapshot(row)
            result = await session.execute(
                delete(SpreadsheetWorkbook).where(
                    SpreadsheetWorkbook.id == identity,
                    SpreadsheetWorkbook.owner_user_id == owner,
                    SpreadsheetWorkbook.revision == revision,
                )
            )
            if result.rowcount != 1:
                raise RevisionConflictError(
                    revision, current.revision, current.model_dump(mode="json")
                )
            if source_key:
                await session.execute(
                    delete(SpreadsheetImport).where(
                        SpreadsheetImport.source_key == source_key,
                        SpreadsheetImport.owner_user_id == owner,
                    )
                )
                # Collect bytes at startup, after all in-flight commits have ended.
            return {"deleted": True}

        return await self._command(
            owner,
            identity,
            {"request_id": request_id, "action": "delete", "expected_revision": revision},
            action,
        )

    async def preview(self, owner, filename, content, encoding):
        document, warnings = await run_blocking_io(import_document, content, filename, encoding)
        # Originals use unique immutable names; uncertain commits are reconciled at startup.
        key = await run_blocking_io(self.originals.write, content)
        identity = str(uuid4())
        digest = hashlib.sha256(content).hexdigest()
        async with self.sessions() as session:
            bind_owner(session, owner)
            session.add(
                SpreadsheetImport(
                    id=identity,
                    owner_user_id=owner,
                    sha256=digest,
                    filename=filename,
                    source_key=key,
                    document=document.model_dump(mode="json"),
                    warnings=warnings,
                    created_at=utc_now().isoformat(),
                )
            )
            await session.commit()
        return SpreadsheetImportPreview(
            id=identity,
            sha256=digest,
            filename=filename,
            warnings=warnings,
            sheets=[s.name for s in document.sheets],
        )

    async def confirm(self, owner, identity, body):
        async def action(session):
            row = await session.scalar(
                select(SpreadsheetImport).where(
                    SpreadsheetImport.id == identity, SpreadsheetImport.owner_user_id == owner
                )
            )
            if row is None:
                raise SpreadsheetError("导入预览不存在", "not_found", 404)
            if row.sha256 != body.sha256 or body.converter != CONVERTER:
                raise SpreadsheetError("导入预览已变化，请重新上传", "preview_mismatch", 409)
            if utc_now() - datetime.fromisoformat(row.created_at) > timedelta(hours=1):
                raise SpreadsheetError("导入预览已过期，请重新上传", "preview_expired", 409)
            if row.warnings and not body.accept_warnings:
                raise SpreadsheetError("请先确认导入差异", "import_confirmation_required", 409)
            return await self._create(
                session,
                owner,
                body.title or row.filename.rsplit(".", 1)[0][:120] or "导入工作簿",
                SpreadsheetDocument.model_validate(row.document),
                row.source_key,
                row.filename,
            )

        return SpreadsheetProject.model_validate(
            await self._command(owner, "import:" + identity, body, action)
        )

    async def original(self, owner, identity):
        async with self.sessions() as session:
            bind_owner(session, owner)
            row = await self._load(session, owner, identity)
            if not row.source_key:
                raise SpreadsheetError("此工作簿没有导入原件", "not_found", 404)
            path, name = self.originals.path(row.source_key), row.source_name
        if not path.is_file():
            raise SpreadsheetError("导入原件暂不可用", "original_unavailable", 503)
        return path, name
