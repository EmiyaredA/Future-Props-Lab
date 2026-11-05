"""Website automation discovery. Navigation returns links without controlling browsers."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.capabilities.web_access.contracts import AccessStatus
from app.capabilities.web_access.profiles import AccessError
from app.console.governance.automation import resource_link
from app.console.governance.automation_access import MANIFEST
from app.console.schemas.automation import (
    AutomationCapabilities,
    AutomationOpenIn,
    AutomationOpenOut,
)
from app.deps import SessionDep, StudioAuth
from app.runtime.operation_receipts import OperationError
from app.runtime.website import require_local_browser
from studio.contracts.gateway.service_status import ServicesStatusOut, monolith_status, status_time

router = APIRouter(prefix="/automation", tags=["automation"])


@router.get("/services", response_model=ServicesStatusOut)
async def service_status(principal: StudioAuth):
    if principal.auth_kind != "session":
        raise HTTPException(403, detail="此状态入口仅供浏览器会话使用")
    return monolith_status(status_time())


@router.get("/capabilities", response_model=AutomationCapabilities)
async def capabilities(request: Request, principal: StudioAuth):
    schema = request.app.openapi()
    operations = {}
    for key, operation in MANIFEST["operations"].items():
        method, path = key.split(" ", 1)
        operations[f"{operation['resource']}.{operation['method']}"] = {
            "method": method,
            "path": path,
            **schema["paths"][path][method.lower()],
        }
    return dict(
        version=MANIFEST["version"],
        user_id=principal.user_id,
        owner_user_id=principal.owner_user_id,
        scopes=sorted(principal.scopes),
        operations=operations,
        schemas=schema["components"]["schemas"],
    )


@router.get("/runtime")
async def runtime(request: Request, principal: StudioAuth) -> dict[str, bool]:
    return {
        "local_browser": principal.auth_kind == "session"
        and bool(getattr(request.state, "website_local", False))
    }


@router.get("/changes")
async def changes(request: Request, principal: StudioAuth) -> dict[str, int]:
    revisions = getattr(request.app.state, "automation_changes", {})
    return {"revision": revisions.get(principal.user_id, 0)}


@router.post("/open", response_model=AutomationOpenOut)
async def open_resource(body: AutomationOpenIn, session: SessionDep, principal: StudioAuth):
    try:
        return AutomationOpenOut(
            **body.model_dump(), path=await resource_link(session, principal, body)
        )
    except OperationError as exc:
        raise HTTPException(exc.status, detail={"code": exc.code, "message": str(exc)}) from exc


def local_access(request, principal):
    require_local_browser(request, principal)
    if not principal.is_platform_admin:
        raise HTTPException(403, detail="仅本机网站平台管理员可管理公网入口")
    access = getattr(request.app.state, "web_access", None)
    if access is None:
        raise HTTPException(503, detail="网站访问管理尚未就绪")
    return access


@router.get("/access", response_model=AccessStatus)
async def access_status(request: Request, principal: StudioAuth):
    return local_access(request, principal).status().model_dump(mode="json")


class AccessAction(BaseModel):
    action: Literal["public_start", "public_stop", "check"]


@router.post("/access/actions", response_model=AccessStatus)
async def access_action(
    request: Request, body: AccessAction, session: SessionDep, principal: StudioAuth
):
    access = local_access(request, principal)
    await session.rollback()
    try:
        return (await access.action(body.action)).model_dump(mode="json")
    except AccessError as exc:
        raise HTTPException(exc.status, detail=str(exc)) from exc
