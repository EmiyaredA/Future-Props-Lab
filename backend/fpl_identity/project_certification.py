"""Issue single-project commands and receive committed audit outcomes from their owner."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import text

from app.capabilities.identity.permissions import effective_permissions
from app.capabilities.identity.route_permissions import route_permission
from app.console.models.accounts import SecurityAuditEvent, User
from app.runtime.ids import new_id
from fpl_runtime.claims import verify_context
from fpl_runtime.project_certification import (
    PREFIX,
    PROJECT_EVENT,
    CertificationAudit,
    CertificationAuditReceipt,
    CertificationAuthorization,
    CertificationProof,
    SignedCertificationAudit,
    issue_certification,
    sign_audit_receipt,
    verify_certification,
)

from .integration_intents import require_client
from .live import active_actor
from .models import CertificationAuditDelivery

router = APIRouter(prefix=PREFIX, include_in_schema=False)


@router.post("/authorize")
async def authorize(request: Request, body: CertificationAuthorization):
    require_client(request, "creative")
    app = request.app.state
    path = body.command.source
    operation = app.service_catalog.match("PATCH", path)
    if (
        operation is None
        or operation.service != "creative"
        or route_permission("PATCH", path) != "projects.certify"
    ):
        raise HTTPException(403, {"code": "project_certification_required"})
    settings = app.identity_options
    try:
        actor = verify_context(
            body.assertion,
            service="creative",
            method="PATCH",
            path=path,
            public_key=settings["private_key"].public_key(),
        )
    except (jwt.InvalidTokenError, ValueError, KeyError, TypeError):
        raise HTTPException(401, {"code": "studio_auth_required"}) from None
    if (
        actor.auth_kind != "session"
        or actor.purpose != "studio"
        or not {"projects.certify", "content.write"}
        <= effective_permissions(actor.platform_role, frozenset(actor.scopes))
        or "studio:write" not in actor.scopes
    ):
        raise HTTPException(403, {"code": "project_certification_required"})
    async with app.database.sessions() as session:
        if not await active_actor(session, actor):
            raise HTTPException(401, {"code": "studio_auth_required"})
    return {
        "authority": issue_certification(
            actor, body.command, private_key=settings["private_key"], key_id=settings["key_id"]
        )
    }


def checked_authority(request, token, *, allow_expired=False):
    try:
        grant = verify_certification(
            token,
            public_key=request.app.state.identity_options["private_key"].public_key(),
            allow_expired=allow_expired,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise HTTPException(401, "certification_authority_required") from None
    require_client(request, grant.command.kind)
    return grant


@router.post("/check")
async def check(request: Request, body: CertificationProof):
    grant = checked_authority(request, body.authority)
    async with request.app.state.database.sessions() as session:
        return {"active": await active_actor(session, grant.actor)}


def signed_audit(request, command, fingerprint, event_id):
    receipt = CertificationAuditReceipt(
        request_id=command.request_id, fingerprint=fingerprint, audit_event_id=event_id
    )
    options = request.app.state.identity_options
    return SignedCertificationAudit(
        receipt=receipt,
        proof=sign_audit_receipt(
            receipt, private_key=options["private_key"], key_id=options["key_id"]
        ),
    )


@router.post("/audit", response_model=SignedCertificationAudit)
async def audit(request: Request, body: CertificationAudit):
    grant = checked_authority(request, body.authority, allow_expired=True)
    command, owner = grant.command, grant.actor.user_id
    if not body.result.matches(command):
        raise HTTPException(409, "certification_audit_result_mismatch")
    request_id = str(command.request_id)
    fingerprint = command.fingerprint(owner)
    async with request.app.state.database.sessions() as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        prior = await session.get(CertificationAuditDelivery, request_id)
        if prior is not None:
            if prior.fingerprint != fingerprint:
                raise HTTPException(409, "certification_audit_receipt_conflict")
            return signed_audit(request, command, fingerprint, prior.audit_event_id)
        user = await session.get(User, owner)
        event_id = new_id()
        session.add(
            SecurityAuditEvent(
                id=event_id,
                actor_user_id=user.id if user else None,
                owner_user_id=user.id if user else None,
                event_type=PROJECT_EVENT,
                client_ip=grant.actor.client_ip or "",
                metadata_json={
                    "status_to": "official" if command.is_official else "ordinary",
                },
            )
        )
        session.add(
            CertificationAuditDelivery(
                id=request_id, fingerprint=fingerprint, audit_event_id=event_id
            )
        )
        await session.commit()
        return signed_audit(request, command, fingerprint, event_id)
