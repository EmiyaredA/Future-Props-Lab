"""Amadeus record operations with independently owned sessions."""

import asyncio

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.console.amadeus.conversations import Conversations
from app.console.amadeus.questions import Questions
from app.console.amadeus.run_records import RunRecords as Runs
from app.console.amadeus.schemas import (
    ActionDecisionIn,
    ActionIn,
    ActionOut,
    ConversationDetailOut,
    ConversationListOut,
    ConversationOut,
    ConversationPatchIn,
    ConversationRevisionConflictOut,
    MessageIn,
    ModelTurnIn,
    ModelTurnOut,
    QuestionAnswerIn,
    QuestionIn,
    QuestionOut,
    RunDetailOut,
    RunEventIn,
    RunEventOut,
    RunFinishIn,
    RunOut,
)
from studio.apps.amadeus.storage.action_records import ActionRecords
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.http.dependencies import SessionDep, StudioAuth

router = APIRouter(prefix="/v1/amadeus", tags=["amadeus"])


@router.get("/conversations", response_model=ConversationListOut)
async def list_conversations(session: SessionDep, principal: StudioAuth) -> ConversationListOut:
    return ConversationListOut(items=await Conversations(session, principal).list())


@router.post("/conversations", response_model=ConversationOut)
async def create_conversation(session: SessionDep, principal: StudioAuth) -> ConversationOut:
    return await Conversations(session, principal).create()


@router.get("/runs/active", response_model=RunDetailOut | None)
async def active_run(session: SessionDep, principal: StudioAuth) -> RunDetailOut | None:
    return await Runs(session, principal).active()


@router.get("/conversations/{conversation_id}/runs", response_model=list[RunDetailOut])
async def list_runs(
    session: SessionDep, principal: StudioAuth, conversation_id: str
) -> list[RunDetailOut]:
    return await Runs(session, principal).history(conversation_id)


@router.get("/conversations/{conversation_id}/runs/{run_id}", response_model=RunDetailOut)
async def get_run(
    session: SessionDep, principal: StudioAuth, conversation_id: str, run_id: str
) -> RunDetailOut:
    return await Runs(session, principal).detail(conversation_id, run_id)


@router.post(
    "/conversations/{conversation_id}/runs/{run_id}/pause-approval", response_model=RunDetailOut
)
async def pause_run_for_approval(
    session: SessionDep, principal: StudioAuth, conversation_id: str, run_id: str
) -> RunDetailOut:
    del session, principal, conversation_id, run_id
    raise HTTPException(410, {"code": "server_owned_run"})


@router.post("/conversations/{conversation_id}/runs/{run_id}/question", response_model=QuestionOut)
async def create_question(
    session: SessionDep, principal: StudioAuth, conversation_id: str, run_id: str, body: QuestionIn
) -> QuestionOut:
    del session, principal, conversation_id, run_id, body
    raise HTTPException(410, {"code": "server_owned_run"})


@router.post(
    "/conversations/{conversation_id}/questions/{question_id}/answer", response_model=QuestionOut
)
async def answer_question(
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    question_id: str,
    body: QuestionAnswerIn,
) -> QuestionOut:
    return await Questions(session, principal).answer(conversation_id, question_id, body)


@router.post("/conversations/{conversation_id}/runs/{run_id}/events", response_model=RunEventOut)
async def append_run_event(
    session: SessionDep, principal: StudioAuth, conversation_id: str, run_id: str, body: RunEventIn
) -> RunEventOut:
    del session, principal, conversation_id, run_id, body
    raise HTTPException(410, {"code": "server_owned_run"})


@router.post("/conversations/{conversation_id}/runs/{run_id}/heartbeat", response_model=RunOut)
async def heartbeat_run(
    session: SessionDep, principal: StudioAuth, conversation_id: str, run_id: str
) -> RunOut:
    del session, principal, conversation_id, run_id
    raise HTTPException(410, {"code": "server_owned_run"})


@router.post("/conversations/{conversation_id}/runs/{run_id}/finish", response_model=RunDetailOut)
async def finish_run(
    session: SessionDep, principal: StudioAuth, conversation_id: str, run_id: str, body: RunFinishIn
) -> RunDetailOut:
    del session, principal, conversation_id, run_id, body
    raise HTTPException(410, {"code": "server_owned_run"})


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailOut)
async def get_conversation(
    session: SessionDep, principal: StudioAuth, conversation_id: str
) -> ConversationDetailOut:
    return await Conversations(session, principal).detail(conversation_id)


@router.patch(
    "/conversations/{conversation_id}",
    response_model=ConversationOut,
    responses={409: {"model": ConversationRevisionConflictOut}},
)
async def patch_conversation(
    session: SessionDep, principal: StudioAuth, conversation_id: str, body: ConversationPatchIn
) -> ConversationOut:
    return await Conversations(session, principal).patch(
        conversation_id, body.expected_revision, body.title, body.model_id
    )


@router.delete(
    "/conversations/{conversation_id}", responses={409: {"model": ConversationRevisionConflictOut}}
)
async def delete_conversation(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    conversation_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    app = request.app.state
    async with app.file_locks.setdefault((principal.user_id, conversation_id), asyncio.Lock()):
        if await ActionRecords(session, principal, conversation_id).active():
            raise OperationError("请先停止正在执行的操作", "action_running", 409)
        await Conversations(session, principal, files_root=app.database.root).delete(
            conversation_id, expected_revision
        )
    return {"deleted": True}


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=ConversationDetailOut,
    responses={409: {"model": ConversationRevisionConflictOut}},
)
async def append_message(
    session: SessionDep, principal: StudioAuth, conversation_id: str, body: MessageIn
) -> ConversationDetailOut:
    return await Conversations(session, principal).add_message(conversation_id, body)


@router.post("/conversations/{conversation_id}/actions", response_model=ActionOut)
async def propose_action(
    session: SessionDep, principal: StudioAuth, conversation_id: str, body: ActionIn
) -> ActionOut:
    return await Conversations(session, principal).propose(conversation_id, body)


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
    return await Conversations(session, principal).decide(conversation_id, action_id, body)


@router.post("/model-turn", response_model=ModelTurnOut)
async def model_turn(session: SessionDep, principal: StudioAuth, body: ModelTurnIn) -> ModelTurnOut:
    del session, principal, body
    raise HTTPException(410, {"code": "external_agent_required"})


@router.post("/model-turn/stream", response_class=StreamingResponse)
async def model_turn_stream(
    session: SessionDep, principal: StudioAuth, body: ModelTurnIn
) -> StreamingResponse:
    del session, principal, body
    raise HTTPException(410, {"code": "external_agent_required"})
