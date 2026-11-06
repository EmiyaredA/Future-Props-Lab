"""Password-verified cloud control authorization on the Identity boundary."""

from fastapi import APIRouter, HTTPException, Request

from studio.apps.identity.use_cases.cloud_unlock import CloudUnlockError
from studio.assembly.http_dependencies import StudioAuth
from studio.assembly.identity_http import session_policy
from studio.contracts.identity.cloud_unlock import CloudUnlockRequest

router = APIRouter()


@router.post("/unlock", status_code=204)
async def unlock(request: Request, body: CloudUnlockRequest, principal: StudioAuth):
    if session_policy(request).purpose != "studio":
        raise HTTPException(403, "请使用网站管理员会话")
    try:
        await request.app.state.cloud_unlocks.grant(
            principal, body.purpose, local=getattr(request.state, "website_local", False)
        )
    except CloudUnlockError as error:
        raise HTTPException(error.status, {"code": error.code, "message": str(error)}) from None
