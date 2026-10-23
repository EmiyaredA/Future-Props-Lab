from __future__ import annotations

import asyncio
import json
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse

from app.console.amadeus.actions import cancel_action, cancel_actions_for_run, execute_action
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
from app.console.amadeus.questions import Questions
from app.console.amadeus.runs import Runs
from app.console.amadeus.schemas import (
    ActionDecisionIn,
    ActionIn,
    ActionOut,
    ConversationDetailOut,
    ConversationListOut,
    ConversationOut,
    ConversationPatchIn,
    ConversationRevisionConflictOut,
    FileListOut,
    FileOut,
    FileWriteIn,
    MessageIn,
    ModelTurnIn,
    ModelTurnOut,
    QuestionAnswerIn,
    QuestionIn,
    QuestionOut,
    RunCreateIn,
    RunDetailOut,
    RunEventIn,
    RunEventOut,
    RunFinishIn,
    RunOut,
)
from app.console.amadeus.scripts import sandbox_available
from app.console.amadeus.skills import load_skill, read_skill_file
from app.deps import SessionDep, StudioAuth
from app.llm.call_logs.credentials import snapshot_from_principal
from app.runtime.operation_receipts import OperationError

router = APIRouter(prefix="/amadeus", tags=["amadeus"])


def require_amadeus_session(principal: StudioAuth) -> None:
    if principal.auth_kind != "session":
        raise HTTPException(403, {"code": "browser_session_required"})


def _error(exc: OperationError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


READ_TOOLS = frozenset(
    {
        "fpl_read",
        "fpl_operations",
        "fpl_operation_read",
        "list_work_files",
        "read_work_file",
        "read_skill_file",
        "inspect_video_reference",
    }
)


async def validate_model_turn(session, principal, body: ModelTurnIn) -> None:
    if not body.run_id:
        if body.subagent_id:
            raise OperationError("子任务必须属于运行", "invalid_subagent", 422)
        return
    run = await Runs(session, principal).get_by_id(body.run_id)
    if run.status != "running":
        raise OperationError("运行已经结束", "run_not_active", 409)
    if body.subagent_id and run.mode != "agent":
        raise OperationError("Plan 模式不能委派子任务", "invalid_subagent", 422)
    allowed = READ_TOOLS if body.subagent_id else READ_TOOLS | {"ask_user", "present_artifact"}
    if (run.mode == "plan" or body.subagent_id) and any(
        item.get("name") not in allowed for item in body.tools
    ):
        raise OperationError("只读运行不能调用写工具", "write_tool_forbidden", 422)


@router.get("/conversations", response_model=ConversationListOut)
async def list_conversations(session: SessionDep, principal: StudioAuth) -> ConversationListOut:
    return ConversationListOut(items=await Conversations(session, principal).list())


@router.post("/conversations", response_model=ConversationOut)
async def create_conversation(session: SessionDep, principal: StudioAuth) -> ConversationOut:
    return await Conversations(session, principal).create()


@router.get("/runs/active", response_model=RunDetailOut | None)
async def active_run(session: SessionDep, principal: StudioAuth) -> RunDetailOut | None:
    return await Runs(session, principal).active()


@router.post("/conversations/{conversation_id}/runs", response_model=RunDetailOut)
async def create_run(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    body: RunCreateIn,
) -> RunDetailOut:
    try:
        from app.console.amadeus.execution import runtime

        result = await Runs(session, principal).create(conversation_id, body)
        runtime(request.app).start(request.app, request.headers, principal, result.run)
        return result
    except OperationError as exc:
        raise _error(exc) from None


@router.get("/conversations/{conversation_id}/runs", response_model=list[RunDetailOut])
async def list_runs(
    session: SessionDep, principal: StudioAuth, conversation_id: str
) -> list[RunDetailOut]:
    try:
        return await Runs(session, principal).history(conversation_id)
    except OperationError as exc:
        raise _error(exc) from None


@router.get("/conversations/{conversation_id}/runs/{run_id}", response_model=RunDetailOut)
async def get_run(
    session: SessionDep, principal: StudioAuth, conversation_id: str, run_id: str
) -> RunDetailOut:
    try:
        return await Runs(session, principal).detail(conversation_id, run_id)
    except OperationError as exc:
        raise _error(exc) from None


@router.post(
    "/conversations/{conversation_id}/runs/{run_id}/pause-approval",
    response_model=RunDetailOut,
)
async def pause_run_for_approval(
    session: SessionDep, principal: StudioAuth, conversation_id: str, run_id: str
) -> RunDetailOut:
    raise HTTPException(410, {"code": "server_owned_run"})
    try:
        return await Runs(session, principal).pause_for_approval(conversation_id, run_id)
    except OperationError as exc:
        raise _error(exc) from None


@router.post(
    "/conversations/{conversation_id}/runs/{run_id}/question",
    response_model=QuestionOut,
)
async def create_question(
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    run_id: str,
    body: QuestionIn,
) -> QuestionOut:
    raise HTTPException(410, {"code": "server_owned_run"})
    try:
        return await Questions(session, principal).create(conversation_id, run_id, body)
    except OperationError as exc:
        raise _error(exc) from None


@router.post(
    "/conversations/{conversation_id}/questions/{question_id}/answer",
    response_model=QuestionOut,
)
async def answer_question(
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    question_id: str,
    body: QuestionAnswerIn,
) -> QuestionOut:
    try:
        return await Questions(session, principal).answer(conversation_id, question_id, body)
    except OperationError as exc:
        raise _error(exc) from None


@router.post("/conversations/{conversation_id}/runs/{run_id}/events", response_model=RunEventOut)
async def append_run_event(
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    run_id: str,
    body: RunEventIn,
) -> RunEventOut:
    raise HTTPException(410, {"code": "server_owned_run"})
    try:
        return await Runs(session, principal).append_event(conversation_id, run_id, body)
    except OperationError as exc:
        raise _error(exc) from None


@router.post("/conversations/{conversation_id}/runs/{run_id}/heartbeat", response_model=RunOut)
async def heartbeat_run(
    session: SessionDep, principal: StudioAuth, conversation_id: str, run_id: str
) -> RunOut:
    raise HTTPException(410, {"code": "server_owned_run"})
    try:
        return await Runs(session, principal).heartbeat(conversation_id, run_id)
    except OperationError as exc:
        raise _error(exc) from None


@router.post("/conversations/{conversation_id}/runs/{run_id}/finish", response_model=RunDetailOut)
async def finish_run(
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    run_id: str,
    body: RunFinishIn,
) -> RunDetailOut:
    raise HTTPException(410, {"code": "server_owned_run"})
    try:
        return await Runs(session, principal).finish(
            conversation_id, run_id, body.status, body.error_message
        )
    except OperationError as exc:
        raise _error(exc) from None


@router.post("/conversations/{conversation_id}/runs/{run_id}/cancel", response_model=RunDetailOut)
async def cancel_run(
    request: Request, session: SessionDep, principal: StudioAuth, conversation_id: str, run_id: str
) -> RunDetailOut:
    try:
        runs = Runs(session, principal)
        await runs.mark_cancelling(conversation_id, run_id)
        await cancel_actions_for_run(session, principal, run_id)
        from app.console.amadeus.execution import runtime

        await runtime(request.app).cancel(run_id)
        return await runs.detail(conversation_id, run_id)
    except OperationError as exc:
        raise _error(exc) from None


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailOut)
async def get_conversation(
    session: SessionDep, principal: StudioAuth, conversation_id: str
) -> ConversationDetailOut:
    try:
        return await Conversations(session, principal).detail(conversation_id)
    except OperationError as exc:
        raise _error(exc) from None


@router.patch(
    "/conversations/{conversation_id}",
    response_model=ConversationOut,
    responses={409: {"model": ConversationRevisionConflictOut}},
)
async def patch_conversation(
    session: SessionDep, principal: StudioAuth, conversation_id: str, body: ConversationPatchIn
) -> ConversationOut:
    try:
        return await Conversations(session, principal).patch(
            conversation_id, body.expected_revision, body.title, body.model_id
        )
    except OperationError as exc:
        raise _error(exc) from None


@router.delete(
    "/conversations/{conversation_id}",
    responses={409: {"model": ConversationRevisionConflictOut}},
)
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


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=ConversationDetailOut,
    responses={409: {"model": ConversationRevisionConflictOut}},
)
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
    raise HTTPException(410, {"code": "external_agent_required"})
    if not principal.allows("models.use"):
        raise HTTPException(403, {"code": "insufficient_permission", "message": "没有模型调用权限"})
    text_parts: list[str] = []
    calls: list[dict] = []
    usage: dict = {}
    try:
        await validate_model_turn(session, principal, body)
        credential = await snapshot_from_principal(session, principal)
        async for line in stream_model_turn(session, principal.workspace_id, body, credential):
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
    raise HTTPException(410, {"code": "external_agent_required"})
    if not principal.allows("models.use"):
        raise HTTPException(403, {"code": "insufficient_permission", "message": "没有模型调用权限"})

    try:
        await validate_model_turn(session, principal, body)
        credential = await snapshot_from_principal(session, principal)
    except OperationError as exc:
        raise _error(exc) from None

    async def events():
        try:
            async for line in stream_model_turn(session, principal.workspace_id, body, credential):
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


@router.get(
    "/conversations/{conversation_id}/skills/{skill_id}/{version}/files/{relative_path:path}"
)
async def skill_file_read(
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    skill_id: str,
    version: str,
    relative_path: str,
) -> dict[str, str | int]:
    try:
        await Conversations(session, principal)._get(conversation_id)
        return read_skill_file(
            principal.workspace_id,
            conversation_id,
            skill_id,
            version,
            relative_path,
        )
    except OperationError as exc:
        raise _error(exc) from None
