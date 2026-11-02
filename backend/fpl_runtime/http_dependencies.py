"""HTTP dependencies for services that only accept verified Identity assertions."""

from datetime import datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.identity.principal import StudioPrincipal
from app.capabilities.identity.route_permissions import route_permission
from fpl_runtime.claims import Actor


async def db_session(request: Request):
    async with request.app.state.database.sessions() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(db_session)]


async def require_studio_auth(request: Request, session: SessionDep):
    actor = getattr(request.state, "service_actor", None)
    if not isinstance(actor, Actor):
        raise HTTPException(401, {"code": "studio_auth_required"})
    principal = StudioPrincipal(
        user_id=actor.user_id,
        platform_role=actor.platform_role,
        must_change_password=False,
        auth_kind=actor.auth_kind,
        scopes=frozenset(actor.scopes),
        session_id=actor.session_id,
        api_key_id=actor.api_key_id,
        reauthenticated_at=datetime.fromisoformat(actor.reauthenticated_at)
        if actor.reauthenticated_at
        else None,
    )
    permission = route_permission(request.method, request.url.path)
    if permission is None or not principal.allows(permission):
        raise HTTPException(403, {"code": "insufficient_permission"})
    scope = (
        "studio:private_read"
        if permission in {"content.read", "logs.read", "diagnostics.model", "docs.developer"}
        else "studio:write"
    )
    if not principal.permits(scope):
        raise HTTPException(403, {"code": "insufficient_scope"})
    request.state.studio_principal = principal
    session.info["owner_user_id"] = principal.user_id
    return principal


StudioAuth = Annotated[StudioPrincipal, Depends(require_studio_auth)]


def owner_from_principal(principal: StudioAuth):
    return principal.user_id


OwnerDep = Annotated[str, Depends(owner_from_principal)]
