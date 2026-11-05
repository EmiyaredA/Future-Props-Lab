"""The stable public automation contract depends on explicit owning-service interfaces."""

from fastapi import APIRouter, HTTPException, Request

from studio.apps.gateway.changes import revision
from studio.apps.gateway.use_cases.resource_links import ResourceLinkError
from studio.contracts.gateway.automation import (
    AutomationCapabilities,
    AutomationOpenIn,
    AutomationOpenOut,
)
from studio.contracts.gateway.service_status import ServicesStatusOut
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.http.dependencies import StudioAuth

router = APIRouter(prefix="/automation", tags=["automation"])


@router.get("/services", response_model=ServicesStatusOut)
async def service_status(request: Request, principal: StudioAuth):
    if principal.auth_kind != "session":
        raise HTTPException(403, {"code": "browser_session_required"})
    try:
        return await request.app.state.service_monitor.snapshot(
            assertion=request.state.service_assertion
        )
    except CapabilityDenied as exc:
        raise HTTPException(exc.status, {"code": "service_status_authorization_denied"}) from exc


@router.get("/capabilities", response_model=AutomationCapabilities)
async def capabilities(request: Request, principal: StudioAuth):
    schema, manifest = request.app.state.public_schema, request.app.state.automation_manifest
    operations = {}
    for key, operation in manifest["operations"].items():
        method, path = key.split(" ", 1)
        operations[f"{operation['resource']}.{operation['method']}"] = {
            "method": method,
            "path": path,
            **schema["paths"][path][method.lower()],
        }
    return {
        "version": manifest["version"],
        "user_id": principal.user_id,
        "owner_user_id": principal.user_id,
        "scopes": sorted(principal.scopes),
        "operations": operations,
        "schemas": schema["components"]["schemas"],
    }


@router.get("/runtime")
async def runtime(request: Request, principal: StudioAuth) -> dict[str, bool]:
    return {
        "local_browser": principal.auth_kind == "session"
        and bool(getattr(request.state, "website_local", False)),
    }


@router.get("/changes")
async def changes(request: Request, principal: StudioAuth) -> dict[str, int]:
    return {"revision": await revision(request.app.state.database, principal.user_id)}


@router.post("/open", response_model=AutomationOpenOut)
async def open_resource(request: Request, body: AutomationOpenIn, principal: StudioAuth):
    try:
        path = await request.app.state.resource_links(request, None, principal).open(
            principal, body
        )
    except ResourceLinkError as exc:
        status = 404 if exc.code == "resource_not_found" else 403
        raise HTTPException(status, {"code": exc.code}) from exc
    except CapabilityDenied as exc:
        raise HTTPException(exc.status, {"code": "resource_authorization_denied"}) from exc
    except CapabilityUnavailable as exc:
        raise HTTPException(
            503, {"code": "owning_service_unavailable", "message": str(exc)}
        ) from exc
    return AutomationOpenOut(**body.model_dump(), path=path)
