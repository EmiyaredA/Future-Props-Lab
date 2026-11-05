"""Published one-shot action execution and NDJSON settlement."""

import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.console.amadeus.schemas import ActionOut
from app.runtime.operation_receipts import OperationError
from fpl_runtime.http_dependencies import StudioAuth

router = APIRouter(prefix="/v1/amadeus", tags=["amadeus"])


@router.post(
    "/conversations/{conversation_id}/actions/{action_id}/execute", response_model=ActionOut
)
async def run_action(
    request: Request, principal: StudioAuth, conversation_id: str, action_id: str
) -> ActionOut:
    task = await request.app.state.actions.start(
        principal,
        conversation_id,
        action_id,
        assertion=request.state.service_assertion,
        path=request.url.path,
    )
    return await asyncio.shield(task)


@router.post(
    "/conversations/{conversation_id}/actions/{action_id}/execute/stream",
    response_class=StreamingResponse,
)
async def run_action_stream(
    request: Request, principal: StudioAuth, conversation_id: str, action_id: str
) -> StreamingResponse:
    async def events():
        try:
            task = await request.app.state.actions.start(
                principal,
                conversation_id,
                action_id,
                assertion=request.state.service_assertion,
                path=request.url.path,
            )
            result = await asyncio.shield(task)
            event = {"type": "end", "action": result.model_dump(mode="json")}
        except OperationError as exc:
            event = {"type": "error", "message": str(exc), "code": exc.code}
        yield json.dumps(event, ensure_ascii=False) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


@router.post(
    "/conversations/{conversation_id}/actions/{action_id}/cancel", response_model=ActionOut
)
async def stop_action(
    request: Request, principal: StudioAuth, conversation_id: str, action_id: str
) -> ActionOut:
    return await request.app.state.actions.cancel(
        principal,
        conversation_id,
        action_id,
        assertion=request.state.service_assertion,
        path=request.url.path,
    )
