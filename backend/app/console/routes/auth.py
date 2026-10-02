"""Shared console route auth and projection helpers."""

from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException, Request, Response

from app.capabilities.identity.security import CSRF_COOKIE, SESSION_ABSOLUTE_DAYS, SESSION_COOKIE
from app.console.governance.profile import avatar_url
from app.console.governance.service import audit_page
from app.console.schemas.accounts import (
    AccountOut,
    ApiKeyOut,
    AuthMeOut,
    CurrentUserOut,
    SecurityAuditEventOut,
    SecurityAuditListOut,
    WorkspaceOut,
)
from app.deps import SessionDep, authenticate_studio_request


def _user_out(user) -> CurrentUserOut:
    return CurrentUserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        avatar_url=avatar_url(user),
        is_platform_admin=user.platform_role == "super_admin",
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
        is_platform_admin=user.platform_role == "super_admin",
        platform_role=user.platform_role,
        must_change_password=user.must_change_password,
        revision=user.revision,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
    )


def _workspace_out(workspace, principal) -> WorkspaceOut:
    return WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        visibility=workspace.visibility,
        revision=workspace.revision,
        access_kind=principal.workspace_access,
        role=principal.member_role,
        permission_keys=sorted(principal.permission_keys),
    )


def _key_out(key) -> ApiKeyOut:
    return ApiKeyOut(
        id=key.id,
        name=key.name,
        key_prefix=key.key_prefix,
        scopes=[str(scope) for scope in key.scopes],
        expires_at=key.expires_at,
        last_used_at=key.last_used_at,
        revoked_at=key.revoked_at,
        revision=key.revision,
        created_at=key.created_at,
    )


def _set_cookies(response: Response, token: str, csrf: str) -> None:
    from app.runtime.config import get_settings

    secure = get_settings().auth_cookie_secure
    max_age = int(timedelta(days=SESSION_ABSOLUTE_DAYS).total_seconds())
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
        max_age=max_age,
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
        max_age=max_age,
    )


def _clear_cookies(response: Response) -> None:
    from app.runtime.config import get_settings

    secure = get_settings().auth_cookie_secure
    response.delete_cookie(SESSION_COOKIE, path="/", secure=secure, samesite="lax")
    response.delete_cookie(CSRF_COOKIE, path="/", secure=secure, samesite="lax")


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


async def _login_out(session, user, workspace, auth_session):
    from app.capabilities.identity.principal import StudioPrincipal
    from app.console.governance.platform_policy import apply_policy

    principal = await apply_policy(
        session,
        StudioPrincipal(
            user_id=user.id,
            workspace_id=workspace.id,
            workspace_access="owner",
            member_role="owner",
            is_platform_admin=user.platform_role == "super_admin",
            platform_role=user.platform_role,
            must_change_password=user.must_change_password,
            auth_kind="session",
            scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
            session_id=auth_session.id,
        ),
    )
    return AuthMeOut(
        user=_user_out(user),
        workspace=_workspace_out(workspace, principal),
        policy_revision=principal.policy_revision,
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
        workspace_id=row.workspace_id,
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
