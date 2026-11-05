"""Cloud factor enrollment and verification on the Identity boundary."""

from fastapi import APIRouter, Request, Response

from app.console.cloud_control import access
from app.console.cloud_control.schemas import Enrollment, VerificationCode
from app.deps import SessionDep, StudioAuth, require_recent_reauthentication
from app.runtime.website import require_local_browser

router = APIRouter()


@router.post("/totp/enroll", response_model=Enrollment)
async def enroll(request: Request, response: Response, db: SessionDep, principal: StudioAuth):
    require_local_browser(request, principal)
    access.require_enabled(principal, local=True)
    require_recent_reauthentication(principal)
    response.headers["Cache-Control"] = "no-store"
    return Enrollment(secret=await access.start_enrollment(db, principal))


@router.post("/totp/confirm", status_code=204)
async def confirm(
    request: Request,
    body: VerificationCode,
    db: SessionDep,
    principal: StudioAuth,
):
    require_local_browser(request, principal)
    access.require_enabled(principal, local=True)
    require_recent_reauthentication(principal)
    await access.verify(db, principal, body.code, enroll=True)
    desktop = getattr(request.app.state, "cloud_desktop", None)
    if desktop is not None:
        desktop.revoke(principal.user_id)


@router.post("/totp/verify", status_code=204)
async def verify(
    request: Request,
    body: VerificationCode,
    db: SessionDep,
    principal: StudioAuth,
):
    access.require_enabled(
        principal, local=getattr(request.state, "website_local", False), desktop=body.desktop
    )
    require_recent_reauthentication(principal)
    await access.verify(db, principal, body.code, desktop=body.desktop)
