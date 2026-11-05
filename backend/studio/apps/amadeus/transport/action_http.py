"""Published one-shot action execution and NDJSON settlement."""

import asyncio
import json
from io import StringIO

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from studio.contracts.amadeus.conversations import ActionOut
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.http.dependencies import StudioAuth

router = APIRouter(prefix="/v1/amadeus", tags=["amadeus"])


class Output:
    def __init__(self):
        self.pending = StringIO()
        self.ready = asyncio.Event()
        self.remaining = 1024 * 1024

    def append(self, text):
        if self.remaining:
            chunk = text[: self.remaining]
            self.remaining -= len(chunk)
            self.pending.write(chunk)
            self.ready.set()

    def drain(self):
        text = self.pending.getvalue()
        self.pending.seek(0)
        self.pending.truncate(0)
        self.ready.clear()
        return text


def line(event):
    return json.dumps(event, ensure_ascii=False) + "\n"


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
        output = Output()
        try:
            task = await request.app.state.actions.start(
                principal,
                conversation_id,
                action_id,
                assertion=request.state.service_assertion,
                path=request.url.path,
                output=output.append,
            )
            while not task.done():
                pending = asyncio.create_task(output.ready.wait())
                try:
                    await asyncio.wait((task, pending), return_when=asyncio.FIRST_COMPLETED)
                finally:
                    pending.cancel()
                    await asyncio.gather(pending, return_exceptions=True)
                if text := output.drain():
                    yield line({"type": "output", "text": text})
            if text := output.drain():
                yield line({"type": "output", "text": text})
            result = await asyncio.shield(task)
            yield line({"type": "end", "action": result.model_dump(mode="json")})
        except OperationError as exc:
            yield line({"type": "error", "message": str(exc), "code": exc.code})

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
