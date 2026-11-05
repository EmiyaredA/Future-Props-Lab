"""Cloud factor enrollment and verification on the Identity boundary."""

from fastapi import APIRouter, HTTPException, Request, Response

from studio.apps.identity.storage import cloud_access as access
from studio.apps.identity.use_cases.cloud_factors import FactorError
from studio.assembly.http_dependencies import (
    StudioAuth,
    require_recent_reauthentication,
)
from studio.contracts.identity.cloud_factors import Enrollment, VerificationCode
from studio.runtime.http.website import require_local_browser

router = APIRouter()


@router.post("/totp/enroll", response_model=Enrollment)
async def enroll(request: Request, response: Response, principal: StudioAuth):
    require_local_browser(request, principal)
    access.require_enabled(principal, local=True)
    require_recent_reauthentication(principal)
    response.headers["Cache-Control"] = "no-store"
    try:
        return Enrollment(secret=await request.app.state.cloud_factors.enroll(principal))
    except FactorError as error:
        raise HTTPException(error.status, error.detail) from None


@router.post("/totp/confirm", status_code=204)
async def confirm(
    request: Request,
    body: VerificationCode,
    principal: StudioAuth,
):
    require_local_browser(request, principal)
    access.require_enabled(principal, local=True)
    require_recent_reauthentication(principal)
    try:
        await request.app.state.cloud_factors.verify(principal, body.code, enroll=True)
    except FactorError as error:
        raise HTTPException(error.status, error.detail) from None
    desktop = getattr(request.app.state, "cloud_desktop", None)
    if desktop is not None:
        desktop.revoke(principal.user_id)


@router.post("/totp/verify", status_code=204)
async def verify(
    request: Request,
    body: VerificationCode,
    principal: StudioAuth,
):
    local = getattr(request.state, "website_local", False)
    access.require_enabled(principal, local=local, desktop=body.desktop)
    require_recent_reauthentication(principal)
    try:
        await request.app.state.cloud_factors.verify(
            principal, body.code, desktop=body.desktop, public=not local
        )
    except FactorError as error:
        raise HTTPException(error.status, error.detail) from None
