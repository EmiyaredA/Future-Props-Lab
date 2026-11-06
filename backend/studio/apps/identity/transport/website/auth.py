"""Shared console route auth and projection helpers."""

from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException, Request, Response

from studio.apps.identity.credentials.operations import audit_page
from studio.apps.identity.profile import avatar_url
from studio.assembly.http_dependencies import SessionDep, authenticate_studio_request
from studio.contracts.identity.accounts import (
    AccountOut,
    ApiKeyOut,
    AuthMeOut,
    CurrentUserOut,
    SecurityAuditEventOut,
    SecurityAuditListOut,
)
from studio.contracts.identity.authentication import SESSION_ABSOLUTE_DAYS
from studio.contracts.identity.permissions import role_permissions
from studio.contracts.identity.session_policy import STUDIO_SESSION, SessionPolicy


def _user_out(user) -> CurrentUserOut:
    return CurrentUserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        avatar_url=avatar_url(user),
        is_platform_admin=user.platform_role == "admin",
        platform_role=user.platform_role,
        revision=user.revision,
    )


def _account_out(user) -> AccountOut:
    return AccountOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        status=user.status,
        email=user.email,
        is_platform_admin=user.platform_role == "admin",
        platform_role=user.platform_role,
        must_change_password=user.must_change_password,
        revision=user.revision,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
    )


def _key_out(key) -> ApiKeyOut:
    return ApiKeyOut(
        id=key.id,
        name=key.name,
        key_prefix=key.key_prefix,
        secret_available=bool(key.secret_ciphertext),
        scopes=[str(scope) for scope in key.scopes],
        expires_at=key.expires_at,
        last_used_at=key.last_used_at,
        revoked_at=key.revoked_at,
        revision=key.revision,
        created_at=key.created_at,
    )


def _set_cookies(
    response: Response,
    token: str,
    csrf: str,
    policy: SessionPolicy = STUDIO_SESSION,
    *,
    secure: bool,
) -> None:
    max_age = int(timedelta(days=SESSION_ABSOLUTE_DAYS).total_seconds())
    response.set_cookie(
        policy.session_cookie,
        token,
        httponly=True,
        secure=secure,
        samesite="lax",
        path=policy.cookie_path,
        max_age=max_age,
    )
    response.set_cookie(
        policy.csrf_cookie,
        csrf,
        httponly=False,
        secure=secure,
        samesite="lax",
        path=policy.cookie_path,
        max_age=max_age,
    )


def _clear_cookies(
    response: Response, policy: SessionPolicy = STUDIO_SESSION, *, secure: bool
) -> None:
    response.delete_cookie(
        policy.session_cookie, path=policy.cookie_path, secure=secure, samesite="lax"
    )
    response.delete_cookie(
        policy.csrf_cookie, path=policy.cookie_path, secure=secure, samesite="lax"
    )


async def _browser_auth(request: Request, session: SessionDep, *, forced: bool = False):
    principal = await authenticate_studio_request(
        request,
        session,
        required_scope="studio:read",
        allow_forced_password_change=forced,
    )
    if principal.auth_kind != "session" or principal.session_id is None:
        raise HTTPException(403, detail={"code": "browser_session_required"})
    return principal


async def _platform_auth(request: Request, session: SessionDep):
    principal = await _browser_auth(request, session)
    if not principal.is_platform_admin:
        raise HTTPException(403, detail={"code": "platform_admin_required"})
    return principal


def _login_out(user, auth_session, *, maintenance=False):
    return AuthMeOut(
        storage_upgrade_required=maintenance,
        user=_user_out(user),
        permission_keys=sorted(role_permissions(user.platform_role)),
        must_change_password=user.must_change_password,
        session_expires_at=auth_session.absolute_expires_at,
    )


def _audit_out(row, actor_username, target_username):
    return SecurityAuditEventOut(
        id=row.id,
        event_type=row.event_type,
        outcome=row.outcome,
        actor_username=actor_username,
        target_username=target_username,
        owner_user_id=row.owner_user_id,
        client_ip=row.client_ip,
        user_agent=row.user_agent,
        metadata={
            key: value
            for key, value in row.metadata_json.items()
            if key
            in {
                "role_from",
                "role_to",
                "status_from",
                "status_to",
                "platform_role_from",
                "platform_role_to",
                "revision",
                "invite_id",
                "platform_admin_from",
                "platform_admin_to",
                "platform_admin",
                "visibility_from",
                "visibility_to",
                "access_kind",
                "key_id",
                "scopes",
                "expires_at_from",
                "expires_at_to",
                "session_id",
            }
        },
        created_at=row.created_at,
    )


async def _audit_response(
    session,
    principal,
    *,
    platform: bool,
    page: int,
    page_size: int,
    event_type: str,
    outcome: str,
    **filters,
):
    rows, total = await audit_page(
        session,
        principal=principal,
        platform=platform,
        page=page,
        page_size=page_size,
        event_type=event_type,
        outcome=outcome,
        **filters,
    )
    return SecurityAuditListOut(
        items=[_audit_out(*row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )
