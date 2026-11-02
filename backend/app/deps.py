from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, WebSocket, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.identity.permissions import role_scopes
from app.capabilities.identity.principal import StudioPrincipal
from app.capabilities.identity.route_permissions import route_permission
from app.capabilities.identity.security import (
    CSRF_COOKIE,
    REAUTH_MINUTES,
    SESSION_ACTIVITY_WRITE_SECONDS,
    SESSION_COOKIE,
    SESSION_IDLE_HOURS,
    hash_secret,
)
from app.console.models import AuthSession, ManagementApiKey, User
from app.runtime.config import get_settings
from app.runtime.db import get_session
from app.runtime.ownership import bind_owner
from app.runtime.time import utc_now


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


def _principal(user, *, auth=None, key=None, scopes=None):
    return StudioPrincipal(
        user_id=user.id,
        platform_role=user.platform_role,
        must_change_password=bool(user.must_change_password),
        auth_kind="session" if auth else "management_api_key",
        scopes=role_scopes(user.platform_role) if scopes is None else frozenset(scopes),
        session_id=auth.id if auth else None,
        api_key_id=key.id if key else None,
        reauthenticated_at=auth.reauthenticated_at if auth else None,
    )


def _valid_session(auth, user, now):
    return (
        user.status == "active"
        and auth.revoked_at is None
        and auth.idle_expires_at > now
        and auth.absolute_expires_at > now
    )


async def authenticate_studio_request(
    request: Request,
    session: AsyncSession,
    *,
    required_scope: str,
    allow_forced_password_change: bool = False,
) -> StudioPrincipal:
    now = utc_now()
    raw = request.cookies.get(SESSION_COOKIE, "")
    if raw:
        row = (
            await session.execute(
                select(AuthSession, User)
                .join(User, User.id == AuthSession.user_id)
                .where(AuthSession.token_hash == hash_secret(raw))
            )
        ).first()
        if row is None or not _valid_session(*row, now):
            raise _unauthorized()
        auth, user = row
        _validate_session_request(request, auth)
        if user.must_change_password and not allow_forced_password_change:
            raise _forbidden("password_change_required", "必须先修改临时密码")
        if (now - auth.last_seen_at).total_seconds() >= SESSION_ACTIVITY_WRITE_SECONDS:
            auth.last_seen_at = now
            auth.idle_expires_at = min(
                now + timedelta(hours=SESSION_IDLE_HOURS), auth.absolute_expires_at
            )
            await session.commit()
        principal = _principal(user, auth=auth)
    else:
        authorization = request.headers.get("Authorization", "")
        if not authorization.lower().startswith("bearer "):
            raise _unauthorized()
        raw = authorization[7:].strip()
        if not raw.startswith("fpm_"):
            raise _unauthorized()
        row = (
            await session.execute(
                select(ManagementApiKey, User)
                .join(User, User.id == ManagementApiKey.user_id)
                .where(ManagementApiKey.key_hash == hash_secret(raw))
            )
        ).first()
        if row is None:
            raise _unauthorized()
        key, user = row
        if (
            user.status != "active"
            or user.must_change_password
            or key.revoked_at is not None
            or key.expires_at <= now
        ):
            raise _unauthorized()
        scopes = set(key.scopes)
        if "studio:write" in scopes:
            scopes.add("studio:read")
        if "studio:read" in scopes:
            scopes.add("studio:private_read")
        principal = _principal(user, key=key, scopes=scopes & role_scopes(user.platform_role))
        if key.last_used_at is None or (now - key.last_used_at).total_seconds() >= 300:
            key.last_used_at = now
            await session.commit()
    if not principal.permits(required_scope):
        raise _forbidden("insufficient_scope", f"缺少 {required_scope} 权限")
    if getattr(request.app.state, "storage_upgrade_required", False) and not (
        request.url.path.startswith("/v1/auth/")
        or request.url.path in {"/v1/file-storage/layout", "/v1/file-storage/layout/migrate"}
    ):
        raise HTTPException(
            503,
            detail={
                "code": "account_storage_upgrade_required",
                "message": "请先完成账号文件迁移并重启应用",
            },
        )
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
    websocket: WebSocket, session: AsyncSession
) -> StudioPrincipal:
    if getattr(
        getattr(websocket.scope.get("app"), "state", None), "storage_upgrade_required", False
    ):
        raise _forbidden("account_storage_upgrade_required", "账号文件迁移未完成")
    raw = websocket.cookies.get(SESSION_COOKIE, "")
    if not raw:
        raise _unauthorized()
    row = (
        await session.execute(
            select(AuthSession, User)
            .join(User, User.id == AuthSession.user_id)
            .where(AuthSession.token_hash == hash_secret(raw))
        )
    ).first()
    if row is None or not _valid_session(*row, utc_now()) or row[1].must_change_password:
        raise _unauthorized()
    principal = _principal(row[1], auth=row[0])
    if not principal.allows("models.use"):
        raise _forbidden("insufficient_permission", "当前账号不能调用模型")
    bind_owner(session, principal.user_id)
    return principal


async def resolve_studio_websocket_principal(websocket: WebSocket) -> StudioPrincipal:
    async for session in get_session():
        return await authenticate_studio_websocket(websocket, session)
    raise RuntimeError("database session dependency did not yield a session")


StudioAuth = Annotated[StudioPrincipal, Depends(require_studio_auth)]
PublicStudioAuth = Annotated[StudioPrincipal, Depends(require_public_studio_auth)]


def owner_from_principal(principal: StudioAuth) -> str:
    return principal.user_id


OwnerDep = Annotated[str, Depends(owner_from_principal)]


def require_recent_reauthentication(principal: StudioPrincipal) -> None:
    if principal.auth_kind != "session":
        raise _forbidden("browser_session_required", "必须使用浏览器 Session")
    if principal.reauthenticated_at is None or utc_now() - principal.reauthenticated_at > timedelta(
        minutes=REAUTH_MINUTES
    ):
        raise _forbidden("reauthentication_required", "请重新验证密码")
