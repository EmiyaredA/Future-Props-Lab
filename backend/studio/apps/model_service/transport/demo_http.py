"""Protocol boundary for Models-owned deterministic demonstrations."""

from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.demo_runtime.engine import completion_sse
from app.demo_runtime.schemas import (
    DemoActionIn,
    DemoConfigIn,
    DemoInstallIn,
    DemoInstallOut,
    DemoServiceOut,
    MockCompletionIn,
    ServiceId,
)
from app.llm.http_errors import mapped
from app.llm.routes.model_capacity import ModelCapacity
from studio.apps.model_service.audit.audit import request_audits
from studio.apps.model_service.transport.http_auth import browser
from studio.assembly.http_dependencies import SessionDep, StudioAuth

router = APIRouter(tags=["demo-services"])
call_router = APIRouter(prefix="/demo-services", tags=["demo-calls"], dependencies=[ModelCapacity])


@router.get("/platform/demo-services", response_model=list[DemoServiceOut])
async def services(request: Request, session: SessionDep):
    await browser(request, session, admin=True)
    return await request.app.state.demo_services.services(session)


@router.put("/platform/demo-services/{service_id}", response_model=DemoServiceOut)
async def configuration(
    service_id: ServiceId, request: Request, session: SessionDep, body: DemoConfigIn
):
    principal = await browser(request, session, admin=True)
    return await request.app.state.demo_services.configure(
        session, principal, service_id, body, audits=request_audits(request)
    )


@router.post("/platform/demo-services/{service_id}/actions", response_model=DemoServiceOut)
async def action(service_id: ServiceId, request: Request, session: SessionDep, body: DemoActionIn):
    principal = await browser(request, session, admin=True)
    return await request.app.state.demo_services.action(
        session, principal, service_id, body, audits=request_audits(request)
    )


@router.post("/account/demo-services/{service_id}/install", response_model=DemoInstallOut)
async def install(
    service_id: ServiceId, request: Request, session: SessionDep, body: DemoInstallIn
):
    principal = await browser(request, session)
    if service_id == "example_tools":
        coordinator = getattr(request.app.state, "demo_installations", None)
        if coordinator is None:
            raise HTTPException(503, "integrations_demo_install_unavailable")
        return await mapped(
            coordinator.start_install(
                session,
                principal,
                body,
                assertion=request.state.service_assertion,
                method=request.method,
                path=request.url.path,
                audits=request_audits(request),
            )
        )
    return await mapped(
        request.app.state.demo_services.install(
            session, principal, service_id, body, audits=request_audits(request)
        )
    )


@call_router.post("/model/chat/completions")
async def mock_completion(request: Request, body: MockCompletionIn, _principal: StudioAuth):
    try:
        payload = await request.app.state.demo_runtime.completion(body.model_dump())
    except RuntimeError as exc:
        raise HTTPException(503, {"code": "demo_service_unavailable", "message": str(exc)}) from exc
    if body.stream:
        return Response(completion_sse(payload), media_type="text/event-stream")
    return payload


@call_router.get("/tools/{tool}")
async def example_tool(
    request: Request,
    tool: str,
    _principal: StudioAuth,
    q: str = Query("", max_length=200),
    id: str = Query("demo-001", max_length=100),
    order_id: str = Query("demo-order", max_length=100),
):
    try:
        return await request.app.state.demo_runtime.tool_reply(
            tool, {"q": q, "id": id, "order_id": order_id}
        )
    except RuntimeError as exc:
        raise HTTPException(503, {"code": "demo_service_unavailable", "message": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(404, {"code": "demo_tool_not_found"}) from exc
