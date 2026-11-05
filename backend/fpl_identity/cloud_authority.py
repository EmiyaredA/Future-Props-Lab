"""Return only current cloud authority for a bound Remote or Workbench request."""

import hashlib
import secrets

import jwt
from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select

from app.capabilities.identity.principal import StudioPrincipal
from app.console.cloud_control import access
from app.console.cloud_control.models import CloudFactor
from fpl_runtime.claims import verify_context
from fpl_runtime.cloud_authority import (
    AUTHORITY_PATH,
    CloudAuthority,
    CloudAuthorityQuery,
    permits_cloud_authority,
)
from fpl_runtime.cloud_setup import SETTINGS_PATH

from .live import active_actor

router = APIRouter(include_in_schema=False)


@router.post(AUTHORITY_PATH, response_model=CloudAuthority)
async def cloud_authority(request: Request, response: Response, body: CloudAuthorityQuery):
    response.headers["Cache-Control"] = "no-store"
    options = request.app.state.identity_options
    expected = options["service_credentials"].get(body.service)
    supplied = request.headers.get("Authorization", "")
    if (
        not expected
        or "origin" in request.headers
        or "cookie" in request.headers
        or not secrets.compare_digest(supplied.encode(), f"Bearer {expected}".encode())
        or not permits_cloud_authority(body.service, body.method, body.path)
    ):
        raise HTTPException(403, "cloud_authority_forbidden")
    catalog = request.app.state.service_catalog
    operation = catalog.match(body.method, body.path)
    if operation is None and body.method == "GET":
        operation = catalog.match_socket(body.path)
    if operation is None or operation.service != body.service:
        raise HTTPException(403, "cloud_authority_forbidden")
    try:
        actor = verify_context(
            body.assertion,
            service=body.service,
            method=body.method,
            path=body.path,
            public_key=options["private_key"].public_key(),
            allow_expired=True,
        )
    except (ValueError, TypeError, jwt.InvalidTokenError):
        return CloudAuthority(active=False)
    if actor.auth_kind != "session" or actor.purpose != "studio" or actor.platform_role != "admin":
        return CloudAuthority(active=False)
    principal = StudioPrincipal(
        user_id=actor.user_id,
        must_change_password=False,
        auth_kind="session",
        scopes=frozenset(actor.scopes),
        platform_role="admin",
        session_id=actor.session_id,
    )
    async with request.app.state.database.sessions() as db:
        if not await active_actor(db, actor):
            return CloudAuthority(active=False)
        enabled = access.allowed(principal, local=actor.local)
        factor = await db.scalar(
            select(CloudFactor.secret).where(CloudFactor.owner_user_id == actor.user_id)
        )
        return CloudAuthority(
            active=True,
            enabled=enabled,
            enrolled=bool(factor)
            and (
                enabled or (actor.local and body.service == "remote" and body.path == SETTINGS_PATH)
            ),
            factor_epoch=hashlib.sha256(factor.encode()).hexdigest() if factor else None,
            unlocked_until=await access.unlock_expiry(db, principal, local=actor.local),
            desktop_configured=access.allowed(principal, local=actor.local, desktop=True),
            desktop_authorized=await access.desktop_authorized(db, principal, local=actor.local),
        )
