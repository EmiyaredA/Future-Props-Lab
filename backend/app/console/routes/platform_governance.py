"""Protocol boundary for platform policy and registration governance."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.capabilities.identity.rate_limit import allow_attempt
from app.console.governance.developer_docs import developer_documents
from app.console.governance.platform_settings import write_setting
from app.console.governance.project_certification import certify_project
from app.console.governance.registration import (
    change_invite,
    create_invite,
    invite_page,
    redemption_page,
    register,
    reveal_invite,
)
from app.console.governance.settings_records import read_setting
from app.console.routes.auth import _browser_auth, _login_out, _platform_auth, _set_cookies
from app.console.schemas.accounts import AuthMeOut
from app.console.schemas.platform_governance import (
    CertificationIn,
    CertificationOut,
    DeveloperDocumentsOut,
    RedemptionPage,
    RegistrationIn,
    RegistrationInviteAction,
    RegistrationInviteCreated,
    RegistrationInviteIn,
    RegistrationInviteOut,
    RegistrationInvitePage,
    RegistrationInvitePatch,
    RuntimeQuotas,
    RuntimeQuotasIn,
    RuntimeQuotasOut,
    SecretOut,
)
from app.deps import SessionDep, client_ip, require_recent_reauthentication

router = APIRouter(tags=["platform-governance"])


@router.get("/platform/runtime-quotas", response_model=RuntimeQuotasOut)
async def get_quotas(request: Request, session: SessionDep):
    await _platform_auth(request, session)
    return await read_setting(session, "runtime_quotas", RuntimeQuotas().model_dump())


@router.patch("/platform/runtime-quotas", response_model=RuntimeQuotasOut)
async def patch_quotas(request: Request, session: SessionDep, body: RuntimeQuotasIn):
    principal = await _platform_auth(request, session)
    return await write_setting(
        session,
        principal,
        "runtime_quotas",
        body.value.model_dump(),
        body.expected_revision,
        client_ip(request),
    )


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
    return await create_invite(session, principal, body, client_ip(request))


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
    return await reveal_invite(session, principal, invite_id, client_ip(request))


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
    if not allow_attempt(f"register:ip:{ip}", 10):
        raise HTTPException(429, {"code": "registration_rate_limited", "message": "请稍后重试"})
    try:
        result = await register(session, body, ip, request.headers.get("User-Agent", ""))
    except ValueError as exc:
        raise HTTPException(422, {"code": "registration_invalid", "message": str(exc)}) from exc
    user, auth, token, csrf = result
    _set_cookies(response, token, csrf)
    return await _login_out(
        session,
        user,
        auth,
        maintenance=getattr(request.app.state, "storage_upgrade_required", False),
    )


@router.get("/account/developer-documents", response_model=DeveloperDocumentsOut)
async def developer_docs(request: Request, response: Response, session: SessionDep):
    principal = await _browser_auth(request, session)
    response.headers["Cache-Control"] = "no-store"
    return developer_documents(principal)


@router.patch("/account/project-certification/{kind}/{project_id}", response_model=CertificationOut)
async def certification(
    kind: Literal["visual", "galgame"],
    project_id: str,
    request: Request,
    session: SessionDep,
    body: CertificationIn,
):
    principal = await _browser_auth(request, session)
    return await certify_project(session, principal, kind, project_id, body, client_ip(request))
