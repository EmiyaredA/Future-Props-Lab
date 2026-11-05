"""Private integration intent enrollment and bounded current authorization."""

from fastapi import APIRouter, Request
from starlette.responses import JSONResponse

from fpl_runtime.external_sync import ExternalIntentGrant
from fpl_runtime.integration_intents import (
    AmadeusToolGrant,
    DemoInstallGrant,
    IntegrationCapacityGrant,
    IntegrationIntentCheck,
    IntegrationIntentInput,
)

from .integration_intents import require_client

router = APIRouter(prefix="/_internal/v1/integration-intents", include_in_schema=False)


@router.post("")
async def create(request: Request, body: IntegrationIntentInput):
    require_client(request, body.caller)
    value = await request.app.state.integration_intents.create(body)
    return JSONResponse(value.model_dump(mode="json"), headers={"Cache-Control": "no-store"})


@router.post("/check")
async def check(request: Request, body: IntegrationIntentCheck):
    require_client(request, body.service)
    value = await request.app.state.integration_intents.check(body)
    return JSONResponse(value.model_dump(mode="json"), headers={"Cache-Control": "no-store"})


@router.post("/capacity-grant")
async def capacity_grant(request: Request, body: IntegrationCapacityGrant):
    require_client(request, "integrations")
    assertion = await request.app.state.integration_intents.capacity_grant(body)
    return JSONResponse({"assertion": assertion}, headers={"Cache-Control": "no-store"})


@router.post("/external-grant")
async def external_grant(request: Request, body: ExternalIntentGrant):
    require_client(request, "thought")
    assertion = await request.app.state.integration_intents.external_grant(body)
    return JSONResponse({"assertion": assertion}, headers={"Cache-Control": "no-store"})


@router.post("/demo-install-grant")
async def demo_install_grant(request: Request, body: DemoInstallGrant):
    require_client(request, "models")
    assertion = await request.app.state.integration_intents.demo_install_grant(body)
    return JSONResponse({"assertion": assertion}, headers={"Cache-Control": "no-store"})


@router.post("/amadeus-tool-grant")
async def amadeus_tool_grant(request: Request, body: AmadeusToolGrant):
    require_client(request, "amadeus")
    assertion = await request.app.state.integration_intents.amadeus_tool_grant(body)
    return JSONResponse({"assertion": assertion}, headers={"Cache-Control": "no-store"})
