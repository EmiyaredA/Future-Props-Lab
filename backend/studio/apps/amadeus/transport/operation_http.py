"""Published operation discovery and read-only calls to registered owners."""

from fastapi import APIRouter, HTTPException, Query, Request

from studio.apps.amadeus.operation_calls import call_registered
from studio.runtime.http.dependencies import StudioAuth

router = APIRouter(prefix="/v1/amadeus", tags=["amadeus"])


@router.get("/operations")
async def list_registered_operations(
    request: Request, principal: StudioAuth, resource: str = Query(default="", max_length=40)
) -> dict[str, list[dict]]:
    if not principal.allows("content.read"):
        raise HTTPException(403, {"code": "insufficient_permission"})
    return {"items": request.app.state.operation_catalog(resource)}


@router.post("/operations/read")
async def read_registered_operation(request: Request, principal: StudioAuth, body: dict) -> dict:
    if not principal.allows("content.read"):
        raise HTTPException(403, {"code": "insufficient_permission"})
    return await call_registered(
        request.app.state.capabilities,
        request.state.service_assertion,
        request.url.path,
        str(body.get("operation", "")),
        body.get("arguments", {}),
        approved=False,
    )
