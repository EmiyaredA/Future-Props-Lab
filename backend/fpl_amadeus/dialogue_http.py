"""Published Code Agent run and cancellation operations."""

from fastapi import APIRouter, Request

from app.console.amadeus.schemas import RunCreateIn, RunDetailOut
from fpl_runtime.http_dependencies import SessionDep, StudioAuth

router = APIRouter(prefix="/v1/amadeus", tags=["amadeus"])


@router.post("/conversations/{conversation_id}/runs", response_model=RunDetailOut)
async def create_run(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    body: RunCreateIn,
) -> RunDetailOut:
    return await request.app.state.runs.create(
        session,
        principal,
        conversation_id,
        body,
        assertion=request.state.service_assertion,
        path=request.url.path,
    )


@router.post("/conversations/{conversation_id}/runs/{run_id}/cancel", response_model=RunDetailOut)
async def cancel_run(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    run_id: str,
) -> RunDetailOut:
    await session.rollback()
    return await request.app.state.runs.cancel(
        principal,
        conversation_id,
        run_id,
        assertion=request.state.service_assertion,
        path=request.url.path,
    )
