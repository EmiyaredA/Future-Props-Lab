"""Account-owned credential validation for Identity and the recovery website."""

import secrets
from datetime import timedelta

from fastapi import HTTPException, Request, WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.identity.http_context import forbidden, unauthorized
from app.capabilities.identity.security import (
    SESSION_ACTIVITY_WRITE_SECONDS,
    SESSION_COOKIE,
    SESSION_IDLE_HOURS,
    hash_secret,
)
from app.capabilities.identity.session_policy import session_policy
from app.console.models import AuthSession, ManagementApiKey, User
from studio.config.settings import get_settings
from studio.contracts.identity.permissions import role_scopes
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.database.ownership import bind_owner
from studio.runtime.time import utc_now

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def validate_session_request(request: Request, auth_session: AuthSession) -> None:
    if request.method not in UNSAFE_METHODS:
        return
    csrf_cookie = request.cookies.get(session_policy(request).csrf_cookie, "")
    csrf_header = request.headers.get("X-CSRF-Token", "")
    if (
        not csrf_cookie
        or not csrf_header
        or not secrets.compare_digest(csrf_cookie, csrf_header)
        or not secrets.compare_digest(hash_secret(csrf_cookie), auth_session.csrf_hash)
    ):
        raise forbidden("csrf_failed", "CSRF 校验失败")
    origin = request.headers.get("Origin", "").rstrip("/")
    request_origin = f"{request.url.scheme}://{request.url.netloc}".rstrip("/")
    allowed = {*get_settings().cors_origin_list, request_origin}
    if not origin or origin not in allowed:
        raise forbidden("origin_not_allowed", "请求来源不受信任")


def principal_from_record(user, *, auth=None, key=None, scopes=None):
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


def valid_session(auth, user, now):
    return (
        user.status == "active"
        and auth.revoked_at is None
        and auth.idle_expires_at > now
        and auth.absolute_expires_at > now
    )


async def authenticate_database_request(
    request: Request,
    session: AsyncSession,
    *,
    required_scope: str,
    allow_forced_password_change: bool = False,
) -> StudioPrincipal:
    now = utc_now()
    raw = request.cookies.get(session_policy(request).session_cookie, "")
    if raw:
        row = (
            await session.execute(
                select(AuthSession, User)
                .join(User, User.id == AuthSession.user_id)
                .where(AuthSession.token_hash == hash_secret(raw))
            )
        ).first()
        if (
            row is None
            or not valid_session(*row, now)
            or (session_policy(request).purpose == "management" and row[1].platform_role != "admin")
        ):
            raise unauthorized()
        auth, user = row
        purpose = "studio"
        if getattr(request.app.state, "service_id", None) == "identity":
            purpose = await session.scalar(
                select(AuthSession.purpose).where(AuthSession.id == auth.id)
            )
        if purpose != session_policy(request).purpose:
            raise unauthorized()
        validate_session_request(request, auth)
        if user.must_change_password and not allow_forced_password_change:
            raise forbidden("password_change_required", "必须先修改临时密码")
        if (now - auth.last_seen_at).total_seconds() >= SESSION_ACTIVITY_WRITE_SECONDS:
            auth.last_seen_at = now
            auth.idle_expires_at = min(
                now + timedelta(hours=SESSION_IDLE_HOURS), auth.absolute_expires_at
            )
            await session.commit()
        principal = principal_from_record(user, auth=auth)
    else:
        if session_policy(request).purpose == "management":
            raise unauthorized()
        authorization = request.headers.get("Authorization", "")
        if not authorization.lower().startswith("bearer "):
            raise unauthorized()
        raw = authorization[7:].strip()
        if not raw.startswith("fpm_"):
            raise unauthorized()
        row = (
            await session.execute(
                select(ManagementApiKey, User)
                .join(User, User.id == ManagementApiKey.user_id)
                .where(ManagementApiKey.key_hash == hash_secret(raw))
            )
        ).first()
        if row is None:
            raise unauthorized()
        key, user = row
        if (
            user.status != "active"
            or user.must_change_password
            or key.revoked_at is not None
            or key.expires_at <= now
        ):
            raise unauthorized()
        scopes = set(key.scopes)
        if "studio:write" in scopes:
            scopes.add("studio:read")
        if "studio:read" in scopes:
            scopes.add("studio:private_read")
        principal = principal_from_record(
            user, key=key, scopes=scopes & role_scopes(user.platform_role)
        )
        if key.last_used_at is None or (now - key.last_used_at).total_seconds() >= 300:
            key.last_used_at = now
            await session.commit()
    if not principal.permits(required_scope):
        raise forbidden("insufficient_scope", f"缺少 {required_scope} 权限")
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


async def authenticate_database_websocket(
    websocket: WebSocket, session: AsyncSession
) -> StudioPrincipal:
    if getattr(
        getattr(websocket.scope.get("app"), "state", None), "storage_upgrade_required", False
    ):
        raise forbidden("account_storage_upgrade_required", "账号文件迁移未完成")
    raw = websocket.cookies.get(SESSION_COOKIE, "")
    if not raw:
        raise unauthorized()
    row = (
        await session.execute(
            select(AuthSession, User)
            .join(User, User.id == AuthSession.user_id)
            .where(AuthSession.token_hash == hash_secret(raw))
        )
    ).first()
    if row is None or not valid_session(*row, utc_now()) or row[1].must_change_password:
        raise unauthorized()
    principal = principal_from_record(row[1], auth=row[0])
    bind_owner(session, principal.user_id)
    return principal
