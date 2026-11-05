"""Website automation discovery. Navigation returns links without controlling browsers."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from studio.apps.gateway.use_cases.resource_links import ResourceLinkError
from studio.assembly.http_dependencies import SessionDep, StudioAuth
from studio.contracts.gateway.automation import (
    AutomationCapabilities,
    AutomationOpenIn,
    AutomationOpenOut,
)
from studio.contracts.gateway.automation_policy import MANIFEST
from studio.contracts.gateway.service_status import ServicesStatusOut, monolith_status, status_time
from studio.contracts.gateway.web_access import AccessError, AccessStatus
from studio.runtime.http.website import require_local_browser

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
async def open_resource(
    request: Request, body: AutomationOpenIn, session: SessionDep, principal: StudioAuth
):
    try:
        return AutomationOpenOut(
            **body.model_dump(),
            path=await request.app.state.resource_links(request, session, principal).open(
                principal, body
            ),
        )
    except ResourceLinkError as exc:
        status = 404 if exc.code == "resource_not_found" else 403
        raise HTTPException(status, detail={"code": exc.code, "message": str(exc)}) from exc


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
