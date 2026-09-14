from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse

from app.accounts.profile import (
    apply_avatar,
    avatar_path,
    avatar_url,
    delete_avatar,
    stage_avatar,
    update_profile,
)
from app.accounts.rate_limit import allow_attempt, clear_attempts
from app.accounts.security import CSRF_COOKIE, SESSION_ABSOLUTE_DAYS, SESSION_COOKIE
from app.accounts.service import (
    AccountError,
    audit_page,
    change_password,
    complete_login,
    complete_logout,
    create_api_key,
    delete_api_key,
    list_active_sessions,
    list_api_keys,
    load_current_auth,
    reauthenticate,
    renew_api_key,
    revoke_api_key,
    revoke_other_sessions,
    revoke_session,
)
from app.deps import (
    SessionDep,
    authenticate_studio_request,
    client_ip,
)
from app.schemas.accounts import (
    AccountAvatarDeleteIn,
    AccountOut,
    AccountProfilePatchIn,
    AccountSessionListOut,
    AccountSessionOut,
    ApiKeyCreatedOut,
    ApiKeyCreateIn,
    ApiKeyOut,
    AuthMeOut,
    ChangePasswordIn,
    CurrentUserOut,
    DeleteApiKeyIn,
    LoginIn,
    ReauthIn,
    RenewApiKeyIn,
    RevokeApiKeyIn,
    SecurityAuditEventOut,
    SecurityAuditListOut,
    WorkspaceOut,
)

router = APIRouter(tags=["accounts"])


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
    from app.core.config import get_settings

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
    from app.core.config import get_settings

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


@router.post("/auth/login", response_model=AuthMeOut)
async def login(request: Request, response: Response, session: SessionDep, body: LoginIn):
    ip = client_ip(request)
    normalized = body.username.strip().lower()
    ip_key = f"login:ip:{ip}"
    user_key = f"login:user:{ip}:{normalized}"
    if not allow_attempt(ip_key, 30) or not allow_attempt(user_key, 5):
        raise HTTPException(429, detail={"code": "login_rate_limited", "message": "请稍后重试"})
    result = await complete_login(
        session,
        username=body.username,
        password=body.password,
        client_ip=ip,
        user_agent=request.headers.get("User-Agent", ""),
    )
    if result is None:
        raise HTTPException(
            401,
            detail={"code": "invalid_credentials", "message": "用户名或密码错误"},
        )
    user, workspace, auth_session, token, csrf = result
    clear_attempts(ip_key, user_key)
    _set_cookies(response, token, csrf)
    return await _login_out(session, user, workspace, auth_session)


async def _login_out(session, user, workspace, auth_session):
    from app.accounts.platform_policy import apply_policy
    from app.accounts.principal import StudioPrincipal

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


@router.get("/auth/me", response_model=AuthMeOut)
async def me(request: Request, session: SessionDep):
    principal = await _browser_auth(request, session, forced=True)
    user, workspace, auth_session = await load_current_auth(session, principal)
    return AuthMeOut(
        policy_revision=principal.policy_revision,
        user=_user_out(user),
        workspace=_workspace_out(workspace, principal),
        must_change_password=user.must_change_password,
        session_expires_at=auth_session.absolute_expires_at if auth_session else None,
    )


@router.post("/auth/reauth", status_code=204)
async def reauth(request: Request, session: SessionDep, body: ReauthIn):
    principal = await _browser_auth(request, session, forced=True)
    ip = client_ip(request)
    if not allow_attempt(f"reauth:ip:{ip}", 30) or not allow_attempt(
        f"reauth:user:{ip}:{principal.user_id}", 5
    ):
        raise HTTPException(429, detail={"code": "login_rate_limited"})
    if not await reauthenticate(session, principal, password=body.password, client_ip=ip):
        raise HTTPException(401, detail={"code": "invalid_credentials"})
    return Response(status_code=204)


@router.post("/auth/change-password", status_code=204)
async def change_current_password(
    request: Request, response: Response, session: SessionDep, body: ChangePasswordIn
):
    principal = await _browser_auth(request, session, forced=True)
    try:
        token, csrf = await change_password(
            session,
            principal,
            current_password=body.current_password,
            new_password=body.new_password,
            client_ip=client_ip(request),
        )
    except (AccountError, ValueError) as exc:
        code = exc.code if isinstance(exc, AccountError) else "password_rejected"
        raise HTTPException(422, detail={"code": code, "message": str(exc)}) from exc
    _set_cookies(response, token, csrf)
    response.status_code = 204
    return response


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, response: Response, session: SessionDep):
    principal = await _browser_auth(request, session, forced=True)
    await complete_logout(session, principal, client_ip=client_ip(request))
    _clear_cookies(response)
    response.status_code = 204
    return response


@router.patch("/account/profile", response_model=CurrentUserOut)
async def patch_profile(request: Request, session: SessionDep, body: AccountProfilePatchIn):
    principal = await _browser_auth(request, session)
    try:
        user = await update_profile(
            session,
            user_id=principal.user_id,
            display_name=body.display_name,
            email=body.email,
            expected_revision=body.expected_revision,
            client_ip=client_ip(request),
        )
    except AccountError as exc:
        raise HTTPException(
            409 if exc.code.endswith("conflict") else 422, detail={"code": exc.code}
        ) from exc
    return _user_out(user)


@router.get("/account/profile", response_model=CurrentUserOut)
async def get_profile(request: Request, session: SessionDep):
    principal = await _browser_auth(request, session)
    user, _workspace, _auth_session = await load_current_auth(session, principal)
    return _user_out(user)


@router.get("/account/profile/avatar", response_class=FileResponse)
async def get_avatar(request: Request, session: SessionDep):
    principal = await _browser_auth(request, session)
    user, _workspace, _auth_session = await load_current_auth(session, principal)
    path = avatar_path(user)
    if path is None or not path.is_file():
        raise HTTPException(404, detail={"code": "profile_avatar_not_found"})
    return FileResponse(
        path,
        media_type=user.avatar_content_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "ETag": f'"{user.avatar_content_sha256}"',
        },
    )


@router.put("/account/profile/avatar", response_model=CurrentUserOut)
async def put_avatar(
    request: Request,
    session: SessionDep,
    file: UploadFile = File(...),
    expected_revision: int = Form(..., ge=0),
):
    principal = await _browser_auth(request, session)
    staged = None
    try:
        staged = await stage_avatar(file)
        user = await apply_avatar(
            session,
            user_id=principal.user_id,
            staged=staged,
            expected_revision=expected_revision,
            client_ip=client_ip(request),
        )
    except AccountError as exc:
        if staged:
            staged.path.unlink(missing_ok=True)
        raise HTTPException(
            409 if exc.code == "revision_conflict" else 422,
            detail={"code": exc.code},
        ) from exc
    finally:
        await file.close()
    return _user_out(user)


@router.delete("/account/profile/avatar", response_model=CurrentUserOut)
async def remove_avatar(request: Request, session: SessionDep, body: AccountAvatarDeleteIn):
    principal = await _browser_auth(request, session)
    try:
        user = await delete_avatar(
            session,
            user_id=principal.user_id,
            expected_revision=body.expected_revision,
            client_ip=client_ip(request),
        )
    except AccountError as exc:
        raise HTTPException(
            409 if exc.code == "revision_conflict" else 422,
            detail={"code": exc.code},
        ) from exc
    return _user_out(user)


@router.get("/account/sessions", response_model=AccountSessionListOut)
async def sessions(request: Request, session: SessionDep):
    principal = await _browser_auth(request, session)
    rows = await list_active_sessions(session, principal)
    items = [
        AccountSessionOut(
            id=row.id,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            idle_expires_at=row.idle_expires_at,
            absolute_expires_at=row.absolute_expires_at,
            client_ip=row.client_ip,
            user_agent=row.user_agent,
            is_current=row.id == principal.session_id,
        )
        for row in rows
    ]
    return AccountSessionListOut(items=items, total=len(items))


@router.delete("/account/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, request: Request, session: SessionDep):
    principal = await _browser_auth(request, session)
    if not await revoke_session(
        session, principal, session_id=session_id, client_ip=client_ip(request)
    ):
        raise HTTPException(404, detail={"code": "session_not_found"})
    return Response(status_code=204)


@router.post("/account/sessions/revoke-others")
async def delete_other_sessions(request: Request, session: SessionDep):
    principal = await _browser_auth(request, session)
    count = await revoke_other_sessions(session, principal, client_ip=client_ip(request))
    return {"revoked": count}


@router.get("/account/api-keys", response_model=list[ApiKeyOut])
async def api_keys(request: Request, session: SessionDep):
    principal = await _browser_auth(request, session)
    return [_key_out(row) for row in await list_api_keys(session, principal)]


@router.post("/account/api-keys", response_model=ApiKeyCreatedOut, status_code=201)
async def add_api_key(request: Request, session: SessionDep, body: ApiKeyCreateIn):
    principal = await _browser_auth(request, session)
    key, secret = await create_api_key(
        session,
        principal,
        name=body.name,
        scopes=list(body.scopes),
        expires_in_days=body.expires_in_days,
        client_ip=client_ip(request),
    )
    return ApiKeyCreatedOut(api_key=_key_out(key), secret=secret)


@router.post("/account/api-keys/{key_id}/revoke", response_model=ApiKeyOut)
async def remove_api_key(key_id: str, request: Request, session: SessionDep, body: RevokeApiKeyIn):
    principal = await _browser_auth(request, session)
    key = await revoke_api_key(
        session,
        principal,
        key_id=key_id,
        expected_revision=body.expected_revision,
        client_ip=client_ip(request),
    )
    return _key_out(key)


@router.post("/account/api-keys/{key_id}/renew", response_model=ApiKeyOut)
async def renew_api_key_expiration(
    key_id: str,
    request: Request,
    session: SessionDep,
    body: RenewApiKeyIn,
):
    principal = await _browser_auth(request, session)
    key = await renew_api_key(
        session,
        principal,
        key_id=key_id,
        expected_revision=body.expected_revision,
        expires_in_days=body.expires_in_days,
        client_ip=client_ip(request),
    )
    return _key_out(key)


@router.delete("/account/api-keys/{key_id}", status_code=204)
async def delete_api_key_record(
    key_id: str,
    request: Request,
    session: SessionDep,
    body: DeleteApiKeyIn,
):
    principal = await _browser_auth(request, session)
    await delete_api_key(
        session,
        principal,
        key_id=key_id,
        expected_revision=body.expected_revision,
        client_ip=client_ip(request),
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


@router.get("/account/security-events", response_model=SecurityAuditListOut)
async def own_audit(
    request: Request,
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    event_type: str = Query("", max_length=64),
    outcome: str = Query("", max_length=16),
):
    principal = await _browser_auth(request, session)
    return await _audit_response(
        session,
        principal,
        platform=False,
        page=page,
        page_size=page_size,
        event_type=event_type,
        outcome=outcome,
    )
