from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, WebSocket, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.permissions import role_scopes
from app.accounts.platform_policy import apply_policy
from app.accounts.principal import StudioPrincipal
from app.accounts.route_permissions import route_permission
from app.accounts.security import (
    CSRF_COOKIE,
    REAUTH_MINUTES,
    SESSION_ACTIVITY_WRITE_SECONDS,
    SESSION_COOKIE,
    SESSION_IDLE_HOURS,
    hash_secret,
)
from app.accounts.workspaces import active_membership, owner_membership, resolve_access
from app.core.config import get_settings
from app.core.db import get_session
from app.core.tenant_context import bind_workspace
from app.core.time import utc_now
from app.models import AuthSession, ManagementApiKey, User, Workspace


async def db_session():
    async for session in get_session():
        yield session


SessionDep = Annotated[AsyncSession, Depends(db_session)]
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "studio_auth_required", "message": "需要登录"},
        headers={"WWW-Authenticate": "Session, Bearer"},
    )


def _forbidden(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=403, detail={"code": code, "message": message})


def _validate_session_request(request: Request, auth_session: AuthSession) -> None:
    if request.method not in _UNSAFE_METHODS:
        return
    csrf_cookie = request.cookies.get(CSRF_COOKIE, "")
    csrf_header = request.headers.get("X-CSRF-Token", "")
    if (
        not csrf_cookie
        or not csrf_header
        or not secrets.compare_digest(csrf_cookie, csrf_header)
        or not secrets.compare_digest(hash_secret(csrf_cookie), auth_session.csrf_hash)
    ):
        raise _forbidden("csrf_failed", "CSRF 校验失败")
    origin = request.headers.get("Origin", "").rstrip("/")
    request_origin = f"{request.url.scheme}://{request.url.netloc}".rstrip("/")
    allowed = {*get_settings().cors_origin_list, request_origin}
    if not origin or origin not in allowed:
        raise _forbidden("origin_not_allowed", "请求来源不受信任")


async def authenticate_studio_request(
    request: Request,
    session: AsyncSession,
    *,
    required_scope: str,
    allow_forced_password_change: bool = False,
) -> StudioPrincipal:
    now = utc_now()
    raw_session = request.cookies.get(SESSION_COOKIE, "")
    if raw_session:
        row = (
            await session.execute(
                select(AuthSession, User)
                .join(User, User.id == AuthSession.user_id)
                .where(AuthSession.token_hash == hash_secret(raw_session))
            )
        ).first()
        if row is None:
            raise _unauthorized()
        auth_session, user = row
        if (
            user.status != "active"
            or auth_session.revoked_at is not None
            or auth_session.idle_expires_at <= now
            or auth_session.absolute_expires_at <= now
        ):
            raise _unauthorized()
        _validate_session_request(request, auth_session)
        if user.must_change_password and not allow_forced_password_change:
            raise _forbidden("password_change_required", "必须先修改临时密码")
        workspace = await session.get(Workspace, auth_session.active_workspace_id)
        if workspace is None:
            raise _unauthorized()
        try:
            access, membership = await resolve_access(session, user=user, workspace=workspace)
        except Exception as exc:
            if request.url.path.rstrip("/") != "/v1/auth/me":
                raise HTTPException(
                    409,
                    detail={
                        "code": "workspace_access_changed",
                        "message": "当前 Workspace 的访问权限已变化",
                    },
                ) from exc
            owner = await owner_membership(session, user_id=user.id)
            if owner is None:
                raise _unauthorized() from exc
            workspace = await session.get(Workspace, owner.workspace_id)
            if workspace is None:
                raise _unauthorized() from exc
            auth_session.active_workspace_id = workspace.id
            access, membership = "owner", owner
            await session.commit()
        scopes = role_scopes(access, membership.role if membership else None)
        if (now - auth_session.last_seen_at).total_seconds() >= SESSION_ACTIVITY_WRITE_SECONDS:
            auth_session.last_seen_at = now
            auth_session.idle_expires_at = min(
                now + timedelta(hours=SESSION_IDLE_HOURS), auth_session.absolute_expires_at
            )
            await session.commit()
        principal = StudioPrincipal(
            user_id=user.id,
            workspace_id=workspace.id,
            membership_id=membership.id if membership else None,
            workspace_access=access,
            member_role=membership.role if membership else None,
            is_platform_admin=user.platform_role == "super_admin",
            platform_role=user.platform_role,
            must_change_password=bool(user.must_change_password),
            auth_kind="session",
            scopes=scopes,
            session_id=auth_session.id,
            reauthenticated_at=auth_session.reauthenticated_at,
        )
    else:
        authorization = request.headers.get("Authorization", "")
        if not authorization.lower().startswith("bearer "):
            raise _unauthorized()
        raw_key = authorization[7:].strip()
        if not raw_key.startswith("fpm_"):
            raise _unauthorized()
        row = (
            await session.execute(
                select(ManagementApiKey, User)
                .join(User, User.id == ManagementApiKey.user_id)
                .where(ManagementApiKey.key_hash == hash_secret(raw_key))
            )
        ).first()
        if row is None:
            raise _unauthorized()
        api_key, user = row
        membership = await active_membership(
            session, user_id=user.id, workspace_id=api_key.workspace_id
        )
        if (
            user.status != "active"
            or user.must_change_password
            or api_key.revoked_at is not None
            or api_key.expires_at <= now
            or (membership is None and user.platform_role not in {"admin", "super_admin"})
        ):
            raise _unauthorized()
        raw_scopes = {str(value) for value in api_key.scopes}
        scopes = set(raw_scopes)
        if "studio:read" in scopes:
            scopes.add("studio:private_read")
        if "studio:write" in scopes:
            scopes.update({"studio:read", "studio:private_read"})
        access = (
            "owner"
            if membership and membership.role == "owner"
            else "platform_admin"
            if user.platform_role in {"admin", "super_admin"}
            else "member"
        )
        principal = StudioPrincipal(
            user_id=user.id,
            workspace_id=api_key.workspace_id,
            membership_id=membership.id if membership else None,
            workspace_access=access,
            member_role=membership.role if membership else None,
            is_platform_admin=user.platform_role == "super_admin",
            platform_role=user.platform_role,
            must_change_password=False,
            auth_kind="management_api_key",
            scopes=frozenset(scopes) & role_scopes(access, membership.role if membership else None),
            api_key_id=api_key.id,
        )
        if api_key.last_used_at is None or (now - api_key.last_used_at).total_seconds() >= 300:
            api_key.last_used_at = now
            await session.commit()
    principal = await apply_policy(session, principal)
    if not principal.permits(required_scope):
        raise _forbidden("insufficient_scope", f"缺少 {required_scope} 权限")
    request.state.studio_principal = principal
    principal = await apply_policy(session, principal)
    bind_workspace(session, principal.workspace_id)
    return principal


async def require_studio_auth(request: Request, session: SessionDep) -> StudioPrincipal:
    permission = route_permission(request.method, request.url.path)
    if permission is None:
        raise _forbidden("unmapped_workspace_operation", "此操作尚未登记权限")
    required = (
        "studio:private_read"
        if permission in {"content.read", "logs.read", "diagnostics.model", "docs.developer"}
        else "studio:write"
    )
    principal = await authenticate_studio_request(request, session, required_scope=required)
    if not principal.allows(permission):
        raise _forbidden("insufficient_permission", "当前工作区角色不允许此操作")
    return principal


async def require_public_studio_auth(request: Request, session: SessionDep) -> StudioPrincipal:
    principal = await authenticate_studio_request(request, session, required_scope="studio:read")
    if principal.auth_kind != "session":
        raise _forbidden("browser_session_required", "公开展台必须使用浏览器 Session")
    return principal


async def authenticate_studio_websocket(
    websocket: WebSocket, session: AsyncSession
) -> StudioPrincipal:
    """Authenticate the browser-only realtime channel without extending cookie lifetime."""
    now = utc_now()
    raw_session = websocket.cookies.get(SESSION_COOKIE, "")
    if not raw_session:
        raise _unauthorized()
    row = (
        await session.execute(
            select(AuthSession, User)
            .join(User, User.id == AuthSession.user_id)
            .where(AuthSession.token_hash == hash_secret(raw_session))
        )
    ).first()
    if row is None:
        raise _unauthorized()
    auth_session, user = row
    if (
        user.status != "active"
        or user.must_change_password
        or auth_session.revoked_at is not None
        or auth_session.idle_expires_at <= now
        or auth_session.absolute_expires_at <= now
    ):
        raise _unauthorized()
    workspace = await session.get(Workspace, auth_session.active_workspace_id)
    if workspace is None:
        raise _unauthorized()
    try:
        access, membership = await resolve_access(session, user=user, workspace=workspace)
    except Exception as exc:
        raise _forbidden("workspace_access_changed", "当前 Workspace 的访问权限已变化") from exc
    scopes = role_scopes(access, membership.role if membership else None)
    if "studio:write" not in scopes:
        raise _forbidden("insufficient_permission", "当前角色不能发起实时模型调用")
    principal = StudioPrincipal(
        user_id=user.id,
        workspace_id=workspace.id,
        membership_id=membership.id if membership else None,
        workspace_access=access,
        member_role=membership.role if membership else None,
        is_platform_admin=user.platform_role == "super_admin",
        platform_role=user.platform_role,
        must_change_password=False,
        auth_kind="session",
        scopes=scopes,
        session_id=auth_session.id,
        reauthenticated_at=auth_session.reauthenticated_at,
    )
    principal = await apply_policy(session, principal)
    bind_workspace(session, principal.workspace_id)
    return principal


async def resolve_studio_websocket_principal(websocket: WebSocket) -> StudioPrincipal:
    """Own the short authentication session outside the protocol route."""
    async for session in get_session():
        return await authenticate_studio_websocket(websocket, session)
    raise RuntimeError("database session dependency did not yield a session")


StudioAuth = Annotated[StudioPrincipal, Depends(require_studio_auth)]
PublicStudioAuth = Annotated[StudioPrincipal, Depends(require_public_studio_auth)]


def workspace_from_principal(principal: StudioAuth) -> str:
    """Expose the authenticated workspace without another source of tenant truth."""
    return principal.workspace_id


WorkspaceDep = Annotated[str, Depends(workspace_from_principal)]


def require_recent_reauthentication(principal: StudioPrincipal) -> None:
    if principal.auth_kind != "session":
        raise _forbidden("browser_session_required", "必须使用浏览器 Session")
    if principal.reauthenticated_at is None or utc_now() - principal.reauthenticated_at > timedelta(
        minutes=REAUTH_MINUTES
    ):
        raise _forbidden("reauthentication_required", "请重新验证密码")
