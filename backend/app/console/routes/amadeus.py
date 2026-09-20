from __future__ import annotations

import asyncio
import json
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse

from app.console.amadeus.actions import cancel_action, execute_action
from app.console.amadeus.conversations import Conversations
from app.console.amadeus.files import (
    MAX_FILE_BYTES,
    list_files,
    open_work_folder,
    read_file_bytes,
    write_file,
)
from app.console.amadeus.fpl_operations import call_operation, operation_catalog
from app.console.amadeus.model_bridge import stream_model_turn
from app.console.amadeus.schemas import (
    ActionDecisionIn,
    ActionIn,
    ActionOut,
    ConversationDetailOut,
    ConversationListOut,
    ConversationOut,
    ConversationPatchIn,
    FileListOut,
    FileOut,
    FileWriteIn,
    MessageIn,
    ModelTurnIn,
    ModelTurnOut,
)
from app.console.amadeus.scripts import sandbox_available
from app.console.amadeus.skills import load_skill
from app.deps import SessionDep, StudioAuth
from app.runtime.operation_receipts import OperationError

router = APIRouter(prefix="/amadeus", tags=["amadeus"])


def require_amadeus_session(principal: StudioAuth) -> None:
    if principal.auth_kind != "session":
        raise HTTPException(403, {"code": "browser_session_required"})


def _error(exc: OperationError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/conversations", response_model=ConversationListOut)
async def list_conversations(session: SessionDep, principal: StudioAuth) -> ConversationListOut:
    return ConversationListOut(items=await Conversations(session, principal).list())


@router.post("/conversations", response_model=ConversationOut)
async def create_conversation(session: SessionDep, principal: StudioAuth) -> ConversationOut:
    return await Conversations(session, principal).create()


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailOut)
async def get_conversation(
    session: SessionDep, principal: StudioAuth, conversation_id: str
) -> ConversationDetailOut:
    try:
        return await Conversations(session, principal).detail(conversation_id)
    except OperationError as exc:
        raise _error(exc) from None


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
async def patch_conversation(
    session: SessionDep, principal: StudioAuth, conversation_id: str, body: ConversationPatchIn
) -> ConversationOut:
    try:
        return await Conversations(session, principal).patch(
            conversation_id, body.expected_revision, body.title, body.model_id
        )
    except OperationError as exc:
        raise _error(exc) from None


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await Conversations(session, principal).delete(conversation_id, expected_revision)
        return {"deleted": True}
    except OperationError as exc:
        raise _error(exc) from None


@router.post("/conversations/{conversation_id}/messages", response_model=ConversationDetailOut)
async def append_message(
    session: SessionDep, principal: StudioAuth, conversation_id: str, body: MessageIn
) -> ConversationDetailOut:
    try:
        return await Conversations(session, principal).add_message(conversation_id, body)
    except OperationError as exc:
        raise _error(exc) from None


@router.post("/conversations/{conversation_id}/actions", response_model=ActionOut)
async def propose_action(
    session: SessionDep, principal: StudioAuth, conversation_id: str, body: ActionIn
) -> ActionOut:
    try:
        return await Conversations(session, principal).propose(conversation_id, body)
    except OperationError as exc:
        raise _error(exc) from None


@router.post(
    "/conversations/{conversation_id}/actions/{action_id}/decision", response_model=ActionOut
)
async def decide_action(
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    action_id: str,
    body: ActionDecisionIn,
) -> ActionOut:
    try:
        return await Conversations(session, principal).decide(conversation_id, action_id, body)
    except OperationError as exc:
        raise _error(exc) from None


@router.post(
    "/conversations/{conversation_id}/actions/{action_id}/execute", response_model=ActionOut
)
async def run_action(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    action_id: str,
) -> ActionOut:
    try:
        return await execute_action(session, principal, conversation_id, action_id, request)
    except OperationError as exc:
        raise _error(exc) from None


@router.post(
    "/conversations/{conversation_id}/actions/{action_id}/execute/stream",
    response_class=StreamingResponse,
)
async def run_action_stream(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    action_id: str,
) -> StreamingResponse:
    async def events():
        queue: asyncio.Queue[str | None] = asyncio.Queue()

        async def work() -> ActionOut:
            try:
                return await execute_action(
                    session,
                    principal,
                    conversation_id,
                    action_id,
                    request,
                    output_callback=lambda chunk: queue.put_nowait(chunk),
                )
            finally:
                queue.put_nowait(None)

        task = asyncio.create_task(work())
        while (chunk := await queue.get()) is not None:
            yield json.dumps({"type": "output", "text": chunk}, ensure_ascii=False) + "\n"
        try:
            result = await task
            yield (
                json.dumps(
                    {"type": "end", "action": result.model_dump(mode="json")}, ensure_ascii=False
                )
                + "\n"
            )
        except OperationError as exc:
            yield json.dumps({"type": "error", "message": str(exc), "code": exc.code}) + "\n"
        except asyncio.CancelledError:
            yield json.dumps({"type": "error", "message": "操作已停止"}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


@router.post(
    "/conversations/{conversation_id}/actions/{action_id}/cancel", response_model=ActionOut
)
async def stop_action(
    session: SessionDep, principal: StudioAuth, conversation_id: str, action_id: str
) -> ActionOut:
    try:
        return await cancel_action(session, principal, conversation_id, action_id)
    except OperationError as exc:
        raise _error(exc) from None


@router.get("/operations")
async def list_registered_operations(
    request: Request, principal: StudioAuth, resource: str = Query(default="", max_length=40)
) -> dict[str, list[dict]]:
    if not principal.allows("content.read"):
        raise HTTPException(403, {"code": "insufficient_permission"})
    return {"items": operation_catalog(request.app, resource)}


@router.post("/operations/read")
async def read_registered_operation(request: Request, principal: StudioAuth, body: dict) -> dict:
    if not principal.allows("content.read"):
        raise HTTPException(403, {"code": "insufficient_permission"})
    try:
        return await call_operation(
            request.app,
            request.headers,
            str(body.get("operation", "")),
            body.get("arguments", {}),
            allow_write=False,
        )
    except OperationError as exc:
        raise _error(exc) from None


@router.post("/model-turn", response_model=ModelTurnOut)
async def model_turn(session: SessionDep, principal: StudioAuth, body: ModelTurnIn) -> ModelTurnOut:
    if not principal.allows("models.use"):
        raise HTTPException(403, {"code": "insufficient_permission", "message": "没有模型调用权限"})
    text_parts: list[str] = []
    calls: list[dict] = []
    usage: dict = {}
    try:
        async for line in stream_model_turn(session, principal.workspace_id, body):
            event = json.loads(line)
            if event["type"] == "delta":
                text_parts.append(event["text"])
            else:
                calls = event["tool_calls"]
                usage = event["usage"]
    except OperationError as exc:
        raise _error(exc) from None
    return ModelTurnOut(text="".join(text_parts), tool_calls=calls, usage=usage)


@router.post("/model-turn/stream", response_class=StreamingResponse)
async def model_turn_stream(
    session: SessionDep, principal: StudioAuth, body: ModelTurnIn
) -> StreamingResponse:
    if not principal.allows("models.use"):
        raise HTTPException(403, {"code": "insufficient_permission", "message": "没有模型调用权限"})

    async def events():
        try:
            async for line in stream_model_turn(session, principal.workspace_id, body):
                yield line
        except OperationError as exc:
            yield json.dumps({"type": "error", "code": exc.code, "message": str(exc)}) + "\n"
        except Exception:
            yield json.dumps({"type": "error", "message": "模型连接或调用失败"}) + "\n"

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/conversations/{conversation_id}/files", response_model=FileListOut)
async def files_list(
    session: SessionDep, principal: StudioAuth, conversation_id: str
) -> FileListOut:
    try:
        await Conversations(session, principal)._get(conversation_id)
        return FileListOut(items=list_files(principal.workspace_id, conversation_id))
    except OperationError as exc:
        raise _error(exc) from None


@router.get("/script-capability")
async def script_capability() -> dict[str, bool]:
    return {"available": sandbox_available()}


@router.post("/conversations/{conversation_id}/files/open-folder")
async def files_open_folder(
    session: SessionDep, principal: StudioAuth, conversation_id: str
) -> dict[str, bool]:
    try:
        await Conversations(session, principal)._get(conversation_id)
        open_work_folder(principal.workspace_id, conversation_id)
        return {"opened": True}
    except OperationError as exc:
        raise _error(exc) from None


@router.get("/conversations/{conversation_id}/files/{kind}/{name}", response_class=Response)
async def file_download(
    session: SessionDep, principal: StudioAuth, conversation_id: str, kind: str, name: str
) -> Response:
    try:
        await Conversations(session, principal)._get(conversation_id)
        data = read_file_bytes(principal.workspace_id, conversation_id, kind, name)
        return Response(
            data, headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"}
        )
    except OperationError as exc:
        raise _error(exc) from None


@router.put("/conversations/{conversation_id}/files/{kind}/{name}", response_model=FileOut)
async def file_write(
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    kind: str,
    name: str,
    body: FileWriteIn,
) -> FileOut:
    try:
        await Conversations(session, principal)._get(conversation_id)
        return FileOut(
            **write_file(
                principal.workspace_id,
                conversation_id,
                kind,
                name,
                body.content.encode(),
                body.expected_sha256,
            )
        )
    except OperationError as exc:
        raise _error(exc) from None


@router.post("/conversations/{conversation_id}/imports", response_model=FileOut)
async def import_file(
    session: SessionDep, principal: StudioAuth, conversation_id: str, upload: UploadFile = File(...)
) -> FileOut:
    try:
        await Conversations(session, principal)._get(conversation_id)
        content = await upload.read(MAX_FILE_BYTES + 1)
        return FileOut(
            **write_file(
                principal.workspace_id,
                conversation_id,
                "imports",
                upload.filename or "import",
                content,
                "",
            )
        )
    except OperationError as exc:
        raise _error(exc) from None
    finally:
        await upload.close()


@router.post("/conversations/{conversation_id}/skills/{skill_id}/load")
async def skill_load(
    session: SessionDep, principal: StudioAuth, conversation_id: str, skill_id: str
) -> dict[str, str]:
    try:
        await Conversations(session, principal)._get(conversation_id)
        return await load_skill(session, principal.workspace_id, conversation_id, skill_id)
    except OperationError as exc:
        raise _error(exc) from None
