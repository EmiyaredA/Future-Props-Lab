"""Models retains only inert audit intent ids and event digests with its mutations."""

from copy import deepcopy
from uuid import uuid4

from app.runtime.time import utc_now
from fpl_runtime.model_audit import ChildModelAudit

from .models import GovernanceAudit


def add_event(session, actor_user_id, prepared):
    session.add(
        GovernanceAudit(
            id=str(prepared.receipt.id),
            actor_user_id=actor_user_id,
            event_type=prepared.event_type,
            detail=deepcopy(prepared.detail),
            created_at=prepared.created_at,
            source_fingerprint=prepared.receipt.fingerprint,
        )
    )


def add_child_event(session, actor_user_id, parent_id, status):
    body = ChildModelAudit(id=uuid4(), parent_id=parent_id, created_at=utc_now(), status=status)
    session.add(
        GovernanceAudit(
            id=str(body.id),
            actor_user_id=actor_user_id,
            event_type="platform.model_template.sync_item",
            detail={"status_to": status},
            created_at=body.created_at,
            parent_intent_id=str(body.parent_id),
            source_fingerprint=body.fingerprint(),
        )
    )


def request_audits(request):
    from fastapi import HTTPException

    client = getattr(request.app.state, "model_audit_client", None)
    if client is None:
        raise HTTPException(503, {"code": "model_audit_unavailable"})

    async def prepare(event_type, detail):
        return await client.prepare(request, event_type, detail)

    return prepare
