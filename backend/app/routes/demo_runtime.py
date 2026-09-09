from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.accounts import demo_services as governance
from app.demo_runtime.runtime import completion, completion_sse, tool_reply
from app.deps import SessionDep, StudioAuth, client_ip
from app.routes.accounts import _browser_auth, _platform_auth
from app.routes.model_capacity import ModelCapacity
from app.schemas.demo_runtime import (
    DemoActionIn,
    DemoConfigIn,
    DemoInstallIn,
    DemoInstallOut,
    DemoServiceOut,
    MockCompletionIn,
    ServiceId,
)

router = APIRouter(tags=["demo-services"])
call_router = APIRouter(prefix="/demo-services", tags=["demo-calls"], dependencies=[ModelCapacity])


@router.get("/platform/demo-services", response_model=list[DemoServiceOut])
async def services(request: Request, session: SessionDep):
    await _platform_auth(request, session)
    return await governance.services(session)


@router.put("/platform/demo-services/{service_id}", response_model=DemoServiceOut)
async def configuration(
    service_id: ServiceId, request: Request, session: SessionDep, body: DemoConfigIn
):
    principal = await _platform_auth(request, session)
    return await governance.configure(session, principal, service_id, body, client_ip(request))


@router.post("/platform/demo-services/{service_id}/actions", response_model=DemoServiceOut)
async def action(service_id: ServiceId, request: Request, session: SessionDep, body: DemoActionIn):
    principal = await _platform_auth(request, session)
    return await governance.action(session, principal, service_id, body, client_ip(request))


@router.post("/account/demo-services/{service_id}/install", response_model=DemoInstallOut)
async def install(
    service_id: ServiceId, request: Request, session: SessionDep, body: DemoInstallIn
):
    principal = await _browser_auth(request, session)
    return await governance.install(
        session, principal, service_id, body.expected_catalog_revision, client_ip(request)
    )


@call_router.post("/model/chat/completions")
async def mock_completion(body: MockCompletionIn, _principal: StudioAuth):
    try:
        payload = await completion(body.model_dump())
    except RuntimeError as exc:
        raise HTTPException(503, {"code": "demo_service_unavailable", "message": str(exc)}) from exc
    if body.stream:
        return Response(completion_sse(payload), media_type="text/event-stream")
    return payload


@call_router.get("/tools/{tool}")
async def example_tool(
    tool: str,
    _principal: StudioAuth,
    q: str = Query("", max_length=200),
    id: str = Query("demo-001", max_length=100),
    order_id: str = Query("demo-order", max_length=100),
):
    try:
        return await tool_reply(tool, {"q": q, "id": id, "order_id": order_id})
    except RuntimeError as exc:
        raise HTTPException(503, {"code": "demo_service_unavailable", "message": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(404, {"code": "demo_tool_not_found"}) from exc
