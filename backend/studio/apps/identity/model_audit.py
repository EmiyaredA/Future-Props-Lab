"""Audit intents retain only fixed event data; no Models JWT is saved."""

from datetime import UTC, datetime

import jwt
from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.console.models.accounts import SecurityAuditEvent, User
from studio.apps.identity.storage.service_models import ModelAuditDelivery, ModelAuditIntent
from studio.contracts.identity.claims import verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.model_service.model_audit import ModelAuditReceipt, PreparedModelAudit

from .live import active_actor


class ModelAuditInbox:
    def __init__(self, database, public_key, catalog):
        self.database, self.key, self.catalog = database, public_key, catalog

    async def prepare(self, body):
        source = body.source
        operation = self.catalog.match(source.method, source.path)
        if operation is None or operation.service != "models":
            raise HTTPException(403, "model_audit_source_forbidden")
        fingerprint = body.fingerprint()
        async with self.database.sessions() as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            prior = await session.get(ModelAuditIntent, str(body.id))
            try:
                actor = verify_context(
                    source.assertion,
                    service="models",
                    method=source.method,
                    path=source.path,
                    public_key=self.key,
                    allow_expired=prior is not None,
                )
            except (jwt.InvalidTokenError, ValueError, TypeError):
                raise HTTPException(401, "model_audit_source_required") from None
            platform = source.path.startswith("/v1/platform/")
            if (
                actor.auth_kind != "session"
                or (platform and (actor.platform_role != "admin" or actor.purpose != "management"))
                or (not platform and actor.purpose != "studio")
                or "configuration.manage"
                not in effective_permissions(actor.platform_role, frozenset(actor.scopes))
            ):
                raise HTTPException(403, "model_audit_source_forbidden")
            if prior is not None:
                if prior.fingerprint != fingerprint:
                    raise HTTPException(409, "model_audit_receipt_conflict")
                return PreparedModelAudit(id=body.id, fingerprint=fingerprint)
            if not await active_actor(session, actor):
                raise HTTPException(401, "model_audit_source_revoked")
            payload = body.model_dump(mode="json", exclude={"source": {"assertion"}})
            payload["actor_user_id"] = actor.user_id
            session.add(ModelAuditIntent(id=str(body.id), fingerprint=fingerprint, payload=payload))
            try:
                await session.commit()
            except Exception:
                # Unknown prepares are retried under the same immutable event id.
                raise
        return PreparedModelAudit(id=body.id, fingerprint=fingerprint)

    async def prepare_child(self, body):
        fingerprint = body.fingerprint()
        async with self.database.sessions() as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            parent = await session.get(ModelAuditIntent, str(body.parent_id))
            delivered = await session.get(ModelAuditDelivery, str(body.parent_id))
            if (
                parent is None
                or delivered is None
                or parent.payload["event_type"] != "platform.model_template.sync_started"
            ):
                raise HTTPException(409, "model_audit_parent_unconfirmed")
            prior = await session.get(ModelAuditIntent, str(body.id))
            if prior is not None:
                if prior.fingerprint != fingerprint or prior.parent_id != str(body.parent_id):
                    raise HTTPException(409, "model_audit_receipt_conflict")
                return PreparedModelAudit(id=body.id, fingerprint=fingerprint)
            count = await session.scalar(
                select(func.count())
                .select_from(ModelAuditIntent)
                .where(ModelAuditIntent.parent_id == str(body.parent_id))
            )
            if count >= 1001:
                raise HTTPException(409, "model_audit_child_limit")
            payload = {
                **parent.payload,
                "id": str(body.id),
                "event_type": "platform.model_template.sync_item",
                "created_at": body.created_at.isoformat(),
                "detail": {"status_to": body.status},
            }
            session.add(
                ModelAuditIntent(
                    id=str(body.id),
                    fingerprint=fingerprint,
                    parent_id=str(body.parent_id),
                    payload=payload,
                )
            )
            await session.commit()
        return PreparedModelAudit(id=body.id, fingerprint=fingerprint)

    async def commit(self, body):
        async with self.database.sessions() as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            intent = await session.get(ModelAuditIntent, str(body.id))
            if intent is None or intent.fingerprint != body.fingerprint:
                raise HTTPException(409, "model_audit_intent_mismatch")
            prior = await session.get(ModelAuditDelivery, str(body.id))
            if prior is not None:
                return ModelAuditReceipt(
                    id=body.id, fingerprint=body.fingerprint, audit_event_id=prior.audit_event_id
                )
            payload = intent.payload
            actor = payload["actor_user_id"]
            if await session.get(User, actor) is None:
                actor = None
            timestamp = datetime.fromisoformat(payload["created_at"])
            if timestamp.tzinfo is not None:
                timestamp = timestamp.astimezone(UTC).replace(tzinfo=None)
            row = SecurityAuditEvent(
                actor_user_id=actor,
                owner_user_id=actor if payload["event_type"] == "demo_service.installed" else None,
                event_type=payload["event_type"],
                outcome="failure"
                if payload["detail"].get("status_to") in {"failed", "skipped"}
                else "success",
                metadata_json=payload["detail"],
                created_at=timestamp,
            )
            session.add(row)
            await session.flush()
            session.add(
                ModelAuditDelivery(
                    id=str(body.id), fingerprint=body.fingerprint, audit_event_id=row.id
                )
            )
            await session.commit()
            return ModelAuditReceipt(
                id=body.id, fingerprint=body.fingerprint, audit_event_id=row.id
            )
