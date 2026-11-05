"""Account-only invitation and registration protocol; independent from model allocation."""

from fastapi import APIRouter, HTTPException, Query, Request, Response

from studio.apps.identity.registration.invitations import (
    change_invite,
    create_invite,
    invite_page,
    redemption_page,
    register,
    reveal_invite,
)
from studio.apps.identity.transport.website.auth import _login_out, _platform_auth, _set_cookies
from studio.assembly.http_dependencies import SessionDep, client_ip, require_recent_reauthentication
from studio.contracts.identity.accounts import AuthMeOut
from studio.contracts.identity.registration import (
    RedemptionPage,
    RegistrationIn,
    RegistrationInviteAction,
    RegistrationInviteCreated,
    RegistrationInviteIn,
    RegistrationInviteOut,
    RegistrationInvitePage,
    RegistrationInvitePatch,
    SecretOut,
)

router = APIRouter(tags=["platform-governance"])


@router.get("/platform/registration-invite-codes", response_model=RegistrationInvitePage)
async def invites(
    request: Request,
    session: SessionDep,
    q: str = Query("", max_length=200),
    status: str = Query("", pattern="^(|active|disabled|expired|exhausted|deleted)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
):
    await _platform_auth(request, session)
    return await invite_page(session, q=q, status=status, page=page, page_size=page_size)


@router.post(
    "/platform/registration-invite-codes", response_model=RegistrationInviteCreated, status_code=201
)
async def add_invite(request: Request, session: SessionDep, body: RegistrationInviteIn):
    principal = await _platform_auth(request, session)
    return await create_invite(
        session,
        principal,
        body,
        client_ip(request),
        encrypt=request.app.state.invitation_cipher.encrypt,
    )


@router.patch(
    "/platform/registration-invite-codes/{invite_id}", response_model=RegistrationInviteOut
)
async def patch_invite(
    invite_id: str, request: Request, session: SessionDep, body: RegistrationInvitePatch
):
    principal = await _platform_auth(request, session)
    return await change_invite(session, principal, invite_id, body, client_ip(request))


@router.post(
    "/platform/registration-invite-codes/{invite_id}/actions", response_model=RegistrationInviteOut
)
async def invite_action(
    invite_id: str, request: Request, session: SessionDep, body: RegistrationInviteAction
):
    principal = await _platform_auth(request, session)
    return await change_invite(session, principal, invite_id, body, client_ip(request))


@router.post("/platform/registration-invite-codes/{invite_id}/secret", response_model=SecretOut)
async def invite_secret(invite_id: str, request: Request, response: Response, session: SessionDep):
    principal = await _platform_auth(request, session)
    require_recent_reauthentication(principal)
    response.headers["Cache-Control"] = "no-store"
    return await reveal_invite(
        session,
        principal,
        invite_id,
        client_ip(request),
        decrypt=request.app.state.invitation_cipher.decrypt,
    )


@router.get(
    "/platform/registration-invite-codes/{invite_id}/redemptions", response_model=RedemptionPage
)
async def redemptions(
    invite_id: str,
    request: Request,
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
):
    await _platform_auth(request, session)
    return await redemption_page(session, invite_id, page, page_size)


@router.post("/auth/register", response_model=AuthMeOut, status_code=201)
async def registration(
    request: Request, response: Response, session: SessionDep, body: RegistrationIn
):
    ip = client_ip(request)
    if not request.app.state.auth_attempts.allow(f"register:ip:{ip}", 10):
        raise HTTPException(429, {"code": "registration_rate_limited", "message": "请稍后重试"})
    account_creator = request.app.state.account_creator
    try:
        result = await register(
            session,
            body,
            ip,
            request.headers.get("User-Agent", ""),
            account_creator=account_creator,
        )
    except ValueError as exc:
        raise HTTPException(422, {"code": "registration_invalid", "message": str(exc)}) from exc
    user, auth, token, csrf = result
    _set_cookies(response, token, csrf, secure=request.app.state.settings.auth_cookie_secure)
    pending = await request.app.state.account_storage_check(session)
    return _login_out(
        user,
        auth,
        maintenance=pending or getattr(request.app.state, "storage_upgrade_required", False),
    )
