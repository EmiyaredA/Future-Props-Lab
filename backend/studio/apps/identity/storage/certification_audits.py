"""Atomic certification audit receipts; no HTTP response or request dependency."""

from sqlalchemy import text

from studio.apps.identity.storage.models.accounts import SecurityAuditEvent, User
from studio.apps.identity.storage.service_models import CertificationAuditDelivery
from studio.contracts.identity.certification import PROJECT_EVENT
from studio.runtime.ids import new_id


class AuditConflict(Exception):
    pass


async def record_audit(session, *, request_id, fingerprint, owner, command, client_ip):
    await session.execute(text("BEGIN IMMEDIATE"))
    prior = await session.get(CertificationAuditDelivery, request_id)
    if prior is not None:
        if prior.fingerprint != fingerprint:
            raise AuditConflict()
        return prior.audit_event_id
    user = await session.get(User, owner)
    event_id = new_id()
    session.add(
        SecurityAuditEvent(
            id=event_id,
            actor_user_id=user.id if user else None,
            owner_user_id=user.id if user else None,
            event_type=PROJECT_EVENT,
            client_ip=client_ip,
            metadata_json={
                "status_to": "official" if command.is_official else "ordinary",
            },
        )
    )
    session.add(
        CertificationAuditDelivery(id=request_id, fingerprint=fingerprint, audit_event_id=event_id)
    )
    await session.commit()
    return event_id
