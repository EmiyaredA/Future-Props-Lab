from fastapi import APIRouter, Depends, HTTPException, Request

from app.console.governance.desktop_setup import (
    DesktopAlreadyInitialized,
    setup_account,
    setup_required,
)
from app.console.schemas.desktop import DesktopSetupIn, DesktopSetupOut
from app.deps import SessionDep


def require_desktop(request: Request) -> None:
    if not getattr(request.app.state, "desktop_enabled", False):
        raise HTTPException(404, detail="Not found")


router = APIRouter(prefix="/desktop", tags=["desktop"], dependencies=[Depends(require_desktop)])


@router.get("/setup", response_model=DesktopSetupOut)
async def get_setup(session: SessionDep):
    return DesktopSetupOut(setup_required=await setup_required(session))


@router.post("/setup", response_model=DesktopSetupOut)
async def create_first_account(request: Request, body: DesktopSetupIn, session: SessionDep):
    if request.headers.get("origin", "").rstrip("/") != str(request.base_url).rstrip("/"):
        raise HTTPException(403, detail="请求来源不受信任")
    try:
        await setup_account(session, **body.model_dump())
    except DesktopAlreadyInitialized as exc:
        raise HTTPException(409, detail="已完成初始化，请使用已有账号登录") from exc
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc
    return DesktopSetupOut(setup_required=False)
