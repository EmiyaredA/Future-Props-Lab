from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request

from app.capabilities.identity.error_views import error_detail
from app.console.governance.account_creation import create_managed_account
from app.console.governance.management import (
    account_page,
    reset_account_password,
    update_account,
)
from app.console.governance.service import AccountError
from app.console.routes.auth import _account_out, _audit_response, _browser_auth, _platform_auth
from app.console.schemas.accounts import (
    AccountCreatedOut,
    AccountCreateIn,
    AccountListOut,
    AccountOut,
    AccountPatchIn,
    AccountResetPasswordIn,
    ResetPasswordOut,
    SecurityAuditListOut,
)
from app.deps import SessionDep, client_ip

router = APIRouter(tags=["account-management"])


def _raise(exc: AccountError):
    status, detail = error_detail(exc)
    raise HTTPException(status, detail) from exc


@router.get("/platform/accounts", response_model=AccountListOut)
async def accounts(
    request: Request,
    session: SessionDep,
    q: str = Query("", max_length=200),
    status: str = Query("", pattern="^(|active|disabled)$"),
    is_platform_admin: bool | None = None,
    platform_role: str = Query("", pattern="^(|admin|user)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
):
    await _platform_auth(request, session)
    rows, total = await account_page(
        session,
        q=q,
        status=status,
        is_platform_admin=is_platform_admin,
        platform_role=platform_role,
        page=page,
        page_size=page_size,
    )
    return AccountListOut(
        items=[_account_out(row) for row in rows], total=total, page=page, page_size=page_size
    )


@router.post("/platform/accounts", response_model=AccountCreatedOut, status_code=201)
async def add_account(request: Request, session: SessionDep, body: AccountCreateIn):
    principal = await _platform_auth(request, session)
    account_creator = request.app.state.account_creator
    try:
        user, temporary = await create_managed_account(
            session,
            principal,
            account_creator=account_creator,
            **body.model_dump(),
            client_ip=client_ip(request),
        )
    except AccountError as exc:
        _raise(exc)
    except ValueError as exc:
        raise HTTPException(422, {"code": "invalid_username", "message": str(exc)}) from exc
    return AccountCreatedOut(account=_account_out(user), temporary_password=temporary)


@router.patch("/platform/accounts/{user_id}", response_model=AccountOut)
async def patch_account(user_id: str, request: Request, session: SessionDep, body: AccountPatchIn):
    principal = await _platform_auth(request, session)
    try:
        user = await update_account(
            session, principal, user_id=user_id, **body.model_dump(), client_ip=client_ip(request)
        )
    except AccountError as exc:
        _raise(exc)
    return _account_out(user)


@router.post("/platform/accounts/{user_id}/reset-password", response_model=ResetPasswordOut)
async def reset_password(
    user_id: str, request: Request, session: SessionDep, body: AccountResetPasswordIn
):
    principal = await _platform_auth(request, session)
    try:
        user, temporary = await reset_account_password(
            session,
            principal,
            user_id=user_id,
            expected_revision=body.expected_revision,
            client_ip=client_ip(request),
        )
    except AccountError as exc:
        _raise(exc)
    return ResetPasswordOut(account=_account_out(user), temporary_password=temporary)


@router.get("/platform/security-events", response_model=SecurityAuditListOut)
async def audit(
    request: Request,
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    event_type: str = Query("", max_length=64),
    outcome: str = Query("", max_length=16),
    actor_query: str = Query("", max_length=64),
    target_query: str = Query("", max_length=64),
    from_date: datetime | None = None,
    to_date: datetime | None = None,
):
    platform = request.url.path.startswith("/v1/platform/")
    principal = (
        await _platform_auth(request, session)
        if platform
        else await _browser_auth(request, session)
    )
    if from_date:
        from_date = (
            from_date.astimezone(UTC).replace(tzinfo=None) if from_date.tzinfo else from_date
        )
    if to_date:
        to_date = to_date.astimezone(UTC).replace(tzinfo=None) if to_date.tzinfo else to_date
    if from_date and to_date and from_date > to_date:
        raise HTTPException(
            422, {"code": "invalid_date_range", "message": "开始时间不能晚于结束时间"}
        )
    return await _audit_response(
        session,
        principal,
        platform=platform,
        page=page,
        page_size=page_size,
        event_type=event_type,
        outcome=outcome,
        actor_query=actor_query,
        target_query=target_query,
        from_date=from_date,
        to_date=to_date,
    )
