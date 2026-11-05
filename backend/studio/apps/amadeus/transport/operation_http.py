"""Published operation discovery and read-only calls to registered owners."""

import json
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query, Request

from studio.apps.amadeus.clients.website_operations import catalog_from_schema
from studio.apps.amadeus.operation_calls import call_registered
from studio.config import REPO_ROOT
from studio.runtime.http.dependencies import StudioAuth

router = APIRouter(prefix="/v1/amadeus", tags=["amadeus"])


@lru_cache(maxsize=1)
def published_catalog():
    root = REPO_ROOT
    installed = root / "deploy/contracts/openapi.json"
    schema = installed if installed.is_file() else root / "web/src/generated/openapi.json"
    return json.loads(schema.read_text())


@router.get("/operations")
async def list_registered_operations(
    principal: StudioAuth, resource: str = Query(default="", max_length=40)
) -> dict[str, list[dict]]:
    if not principal.allows("content.read"):
        raise HTTPException(403, {"code": "insufficient_permission"})
    return {"items": catalog_from_schema(published_catalog(), resource)}


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
