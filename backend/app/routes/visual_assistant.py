from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.deps import SessionDep
from app.schemas.visual_workshop import (
    VisualAssistantConversationListOut,
    VisualAssistantConversationOut,
    VisualAssistantConversationPatchIn,
    VisualAssistantModelOptionListOut,
    VisualAssistantSendIn,
)
from app.visual_workshop.assistant import (
    AssistantAssetError,
    AssistantBusyError,
    AssistantModelUnavailableError,
    AssistantNotFoundError,
    VisualAssistantConversations,
)
from app.visual_workshop.assistant_stream import assistant_events

router = APIRouter(
    prefix="/visual-workshop/projects/{project_id}/conversations",
    tags=["visual-workshop-assistant"],
)


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, AssistantNotFoundError):
        return HTTPException(404, {"code": "not_found", "message": str(exc)})
    if isinstance(exc, AssistantAssetError):
        return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
    if isinstance(exc, AssistantModelUnavailableError):
        return HTTPException(409, {"code": "model_unavailable", "message": str(exc)})
    return HTTPException(409, {"code": "conversation_busy", "message": str(exc)})


@router.get("", response_model=VisualAssistantConversationListOut)
async def list_conversations(
    session: SessionDep, project_id: str
) -> VisualAssistantConversationListOut:
    try:
        return await VisualAssistantConversations(session).list(project_id)
    except AssistantNotFoundError as exc:
        raise _translate(exc) from None


@router.post("", response_model=VisualAssistantConversationOut)
async def create_conversation(
    session: SessionDep, project_id: str
) -> VisualAssistantConversationOut:
    try:
        return await VisualAssistantConversations(session).create(project_id)
    except (AssistantNotFoundError, AssistantModelUnavailableError) as exc:
        raise _translate(exc) from None


@router.get("/models", response_model=VisualAssistantModelOptionListOut)
async def list_models(session: SessionDep, project_id: str) -> VisualAssistantModelOptionListOut:
    try:
        return await VisualAssistantConversations(session).model_options(project_id)
    except AssistantNotFoundError as exc:
        raise _translate(exc) from None


@router.get("/{conversation_id}", response_model=VisualAssistantConversationOut)
async def get_conversation(
    session: SessionDep, project_id: str, conversation_id: str
) -> VisualAssistantConversationOut:
    try:
        return await VisualAssistantConversations(session).get(project_id, conversation_id)
    except AssistantNotFoundError as exc:
        raise _translate(exc) from None


@router.patch("/{conversation_id}", response_model=VisualAssistantConversationOut)
async def patch_conversation(
    session: SessionDep,
    project_id: str,
    conversation_id: str,
    body: VisualAssistantConversationPatchIn,
) -> VisualAssistantConversationOut:
    try:
        return await VisualAssistantConversations(session).patch(project_id, conversation_id, body)
    except (
        AssistantNotFoundError,
        AssistantBusyError,
        AssistantModelUnavailableError,
    ) as exc:
        raise _translate(exc) from None


@router.delete("/{conversation_id}")
async def delete_conversation(
    session: SessionDep,
    project_id: str,
    conversation_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await VisualAssistantConversations(session).delete(
            project_id, conversation_id, expected_revision
        )
    except (AssistantNotFoundError, AssistantBusyError) as exc:
        raise _translate(exc) from None
    return {"deleted": True}


@router.post("/{conversation_id}/messages/stream")
async def stream_message(
    session: SessionDep,
    project_id: str,
    conversation_id: str,
    body: VisualAssistantSendIn,
) -> StreamingResponse:
    try:
        prepared = await VisualAssistantConversations(session).prepare_send(
            project_id,
            conversation_id,
            body.expected_revision,
            body.content,
            body.asset_ids,
        )
    except (
        AssistantNotFoundError,
        AssistantBusyError,
        AssistantModelUnavailableError,
        AssistantAssetError,
    ) as exc:
        raise _translate(exc) from None
    return StreamingResponse(
        assistant_events(prepared),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
