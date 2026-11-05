from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import Depends, Request, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import HTTPConnection

from app.capabilities.identity.http_context import client_ip as client_ip
from app.capabilities.identity.http_context import forbidden as _forbidden
from app.capabilities.identity.http_context import (
    require_recent_reauthentication as require_recent_reauthentication,
)
from app.capabilities.identity.http_context import unauthorized as _unauthorized
from app.runtime.ownership import bind_owner
from studio.contracts.identity.claims import Actor
from studio.contracts.identity.principal import StudioPrincipal
from studio.contracts.identity.route_permissions import route_permission


async def db_session(connection: HTTPConnection):
    async with connection.app.state.database.sessions() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(db_session)]


async def authenticate_studio_request(
    request: Request,
    session: AsyncSession,
    *,
    required_scope: str,
    allow_forced_password_change: bool = False,
) -> StudioPrincipal:
    authenticator = getattr(request.app.state, "studio_http_auth", None)
    if authenticator is not None:
        return await authenticator(
            request,
            session,
            required_scope=required_scope,
            allow_forced_password_change=allow_forced_password_change,
        )
    actor = getattr(request.state, "service_actor", None)
    if not isinstance(actor, Actor):
        raise _unauthorized()
    principal = StudioPrincipal(
        user_id=actor.user_id,
        platform_role=actor.platform_role,
        must_change_password=False,
        auth_kind=actor.auth_kind,
        scopes=frozenset(actor.scopes),
        session_id=actor.session_id,
        api_key_id=actor.api_key_id,
        reauthenticated_at=(
            datetime.fromisoformat(actor.reauthenticated_at) if actor.reauthenticated_at else None
        ),
    )
    if not principal.permits(required_scope):
        raise _forbidden("insufficient_scope", f"缺少 {required_scope} 权限")
    request.state.studio_principal = principal
    bind_owner(session, principal.user_id)
    return principal


async def require_studio_auth(request: Request, session: SessionDep) -> StudioPrincipal:
    permission = route_permission(request.method, request.url.path)
    if permission is None:
        raise _forbidden("unmapped_account_operation", "此操作尚未登记权限")
    scope = (
        "studio:private_read"
        if permission in {"content.read", "logs.read", "diagnostics.model", "docs.developer"}
        else "studio:write"
    )
    principal = await authenticate_studio_request(request, session, required_scope=scope)
    if not principal.allows(permission):
        raise _forbidden("insufficient_permission", "当前账号不允许此操作")
    return principal


async def require_public_studio_auth(request: Request, session: SessionDep) -> StudioPrincipal:
    principal = await authenticate_studio_request(request, session, required_scope="studio:read")
    if principal.auth_kind != "session":
        raise _forbidden("browser_session_required", "社区必须使用浏览器 Session")
    return principal


async def authenticate_studio_websocket(
    websocket: WebSocket, session: AsyncSession, permission: str = "models.use"
) -> StudioPrincipal:
    authenticator = getattr(websocket.app.state, "studio_socket_auth", None)
    if authenticator is None:
        raise _unauthorized()
    principal = await authenticator(websocket, session)
    if not principal.allows(permission):
        raise _forbidden("insufficient_permission", "当前账号不允许此操作")
    return principal


async def resolve_studio_websocket_principal(
    websocket: WebSocket, permission: str = "models.use"
) -> StudioPrincipal:
    async with websocket.app.state.database.sessions() as session:
        return await authenticate_studio_websocket(websocket, session, permission)


StudioAuth = Annotated[StudioPrincipal, Depends(require_studio_auth)]
PublicStudioAuth = Annotated[StudioPrincipal, Depends(require_public_studio_auth)]


def owner_from_principal(principal: StudioAuth) -> str:
    return principal.user_id


OwnerDep = Annotated[str, Depends(owner_from_principal)]
