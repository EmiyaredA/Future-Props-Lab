"""The stable public automation contract depends on explicit owning-service interfaces."""

from fastapi import APIRouter, HTTPException, Request

from app.console.schemas.automation import (
    AutomationCapabilities,
    AutomationOpenIn,
    AutomationOpenOut,
)
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.http_dependencies import StudioAuth
from fpl_runtime.resource_routes import RESOURCE_ROUTES, page_link

from .changes import revision

router = APIRouter(prefix="/automation", tags=["automation"])


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
    if body.view in {"upload", "tags", "edit", "validate"} and not principal.allows(
        "configuration.manage"
    ):
        raise HTTPException(403, {"code": "insufficient_permission"})
    route = RESOURCE_ROUTES[body.kind]
    if body.resource_id:
        try:
            exists = await request.app.state.capabilities.resource_exists(
                assertion=request.state.service_assertion,
                target_service=route.service,
                target_path=route.api.format(id=body.resource_id),
            )
        except CapabilityDenied as exc:
            raise HTTPException(exc.status, {"code": "resource_authorization_denied"}) from exc
        except CapabilityUnavailable as exc:
            raise HTTPException(
                503, {"code": "owning_service_unavailable", "message": str(exc)}
            ) from exc
        if not exists:
            raise HTTPException(404, {"code": "resource_not_found"})
    return AutomationOpenOut(
        **body.model_dump(), path=page_link(body.kind, body.resource_id, body.view)
    )
