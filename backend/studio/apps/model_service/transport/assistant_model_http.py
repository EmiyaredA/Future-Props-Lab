"""Run normalized provider rounds for the owned Visual harness."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from studio.apps.model_service.catalog_reads import owned_catalog
from studio.contracts.visual_workshop.visual_assistant import MODEL_RUNS
from studio.contracts.visual_workshop.visual_assistant_model import (
    SETTLEMENTS,
    AssistantModelPlan,
    AssistantRound,
    AssistantRunSettle,
    AssistantRunStart,
    RecoveredAssistantSettlement,
)

router = APIRouter(include_in_schema=False)
RUN = MODEL_RUNS + "/{project_id}/{conversation_id}/{run_id}"


def require_exact(request, body):
    if request.url.path != body.path:
        raise HTTPException(403, "visual_assistant_model_scope_changed")


@router.post(RUN + "/begin/{digest}", response_model=AssistantModelPlan)
async def begin_assistant_run(request: Request, body: AssistantRunStart):
    require_exact(request, body)
    async with owned_catalog(
        request, purpose="visual_assistant_model", permission="models.use"
    ) as (
        actor,
        _session,
    ):
        return await request.app.state.assistant_model_runs.begin(actor, body)


@router.post(RUN + "/round/{index}/{digest}")
async def stream_assistant_round(request: Request, body: AssistantRound):
    require_exact(request, body)
    runs = request.app.state.assistant_model_runs
    async with owned_catalog(
        request, purpose="visual_assistant_model", permission="models.use"
    ) as (
        actor,
        _session,
    ):
        prepared = await runs.prepare_round(actor, body)
    return StreamingResponse(
        runs.stream(actor, body, prepared),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "private, no-store", "X-Accel-Buffering": "no"},
    )


@router.post(RUN + "/settle/{digest}")
async def settle_assistant_run(request: Request, body: AssistantRunSettle):
    require_exact(request, body)
    async with owned_catalog(
        request, purpose="visual_assistant_model", permission="models.use"
    ) as (
        actor,
        _session,
    ):
        return await request.app.state.assistant_model_runs.settle(actor, body)


@router.post(SETTLEMENTS + "/{run_id}/{digest}")
async def recover_assistant_settlement(request: Request, body: RecoveredAssistantSettlement):
    require_exact(request, body)
    state = request.app.state
    peer = state.assistant_settlement_peer
    if peer is None:
        raise HTTPException(503, "assistant_settlement_peer_unavailable")
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "assistant_settlement_peer_required")
    try:
        owner = peer.owner("POST", request.url.path, request.headers)
    except ValueError:
        raise HTTPException(401, "assistant_settlement_peer_required") from None
    return await state.assistant_model_runs.settle_for(owner, body.outcome, trace_id=body.trace_id)
