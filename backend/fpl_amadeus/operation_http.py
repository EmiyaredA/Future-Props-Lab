"""Published operation discovery and read-only calls to registered owners."""

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request

from app.console.amadeus.fpl_operations import catalog_from_schema
from fpl_runtime.http_dependencies import StudioAuth

from .operation_calls import call_registered

router = APIRouter(prefix="/v1/amadeus", tags=["amadeus"])


@lru_cache(maxsize=1)
def published_catalog():
    root = Path(__file__).resolve().parents[2]
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
