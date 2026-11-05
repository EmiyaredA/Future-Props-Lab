"""Run normalized provider rounds for the owned Visual harness."""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from fpl_runtime.visual_assistant import MODEL_RUNS
from fpl_runtime.visual_assistant_model import (
    AssistantModelPlan,
    AssistantRound,
    AssistantRunSettle,
    AssistantRunStart,
)

from .catalog_reads import owned_catalog

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
