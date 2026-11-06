"""Cloud Control operations owned by the independent gateway."""

from fastapi import APIRouter, Depends, HTTPException

from studio.contracts.identity.happier import HappierLaunch
from studio.runtime.http.dependencies import require_studio_auth

router = APIRouter(prefix="/cloud-control")


@router.post(
    "/happier/launch",
    response_model=HappierLaunch,
    dependencies=[Depends(require_studio_auth)],
)
async def launch_happier():
    raise HTTPException(403, "该账号或入口未启用 Happier")
