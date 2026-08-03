from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.deps import SessionDep
from app.llm.catalog.service import ResourceNotFoundError
from app.llm.playground.service import (
    ConversationBusyError,
    ModelTestService,
    ModelUnavailableError,
    RegenerateUnavailableError,
)
from app.llm.playground.stream import generation_events
from app.schemas.model_test import (
    ModelTestConversationCreateIn,
    ModelTestConversationListOut,
    ModelTestConversationOut,
    ModelTestConversationPatchIn,
    ModelTestRegenerateIn,
    ModelTestSendIn,
)

router = APIRouter(prefix="/model-test/conversations", tags=["model-test"])


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, ResourceNotFoundError):
        return HTTPException(404, {"code": "not_found", "message": str(exc)})
    if isinstance(exc, ModelUnavailableError):
        return HTTPException(409, {"code": "model_unavailable", "message": str(exc)})
    if isinstance(exc, ConversationBusyError):
        return HTTPException(409, {"code": "conversation_busy", "message": str(exc)})
    return HTTPException(409, {"code": "regenerate_unavailable", "message": str(exc)})


@router.get("", response_model=ModelTestConversationListOut)
async def list_conversations(session: SessionDep) -> ModelTestConversationListOut:
    return await ModelTestService(session).list()


@router.post("", response_model=ModelTestConversationOut)
async def create_conversation(
    session: SessionDep, body: ModelTestConversationCreateIn
) -> ModelTestConversationOut:
    try:
        return await ModelTestService(session).create(body)
    except ModelUnavailableError as exc:
        raise _translate(exc) from None


@router.get("/{conversation_id}", response_model=ModelTestConversationOut)
async def get_conversation(session: SessionDep, conversation_id: str) -> ModelTestConversationOut:
    try:
        return await ModelTestService(session).get(conversation_id)
    except ResourceNotFoundError as exc:
        raise _translate(exc) from None


@router.patch("/{conversation_id}", response_model=ModelTestConversationOut)
async def patch_conversation(
    session: SessionDep,
    conversation_id: str,
    body: ModelTestConversationPatchIn,
) -> ModelTestConversationOut:
    try:
        return await ModelTestService(session).patch(conversation_id, body)
    except (ResourceNotFoundError, ModelUnavailableError, ConversationBusyError) as exc:
        raise _translate(exc) from None


@router.delete("/{conversation_id}")
async def delete_conversation(
    session: SessionDep,
    conversation_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await ModelTestService(session).delete(conversation_id, expected_revision)
    except (ResourceNotFoundError, ConversationBusyError) as exc:
        raise _translate(exc) from None
    return {"deleted": True}


@router.post("/{conversation_id}/messages/stream")
async def stream_message(
    session: SessionDep,
    conversation_id: str,
    body: ModelTestSendIn,
) -> StreamingResponse:
    try:
        prepared = await ModelTestService(session).prepare_send(
            conversation_id, body.expected_revision, body.content
        )
    except (ResourceNotFoundError, ModelUnavailableError, ConversationBusyError) as exc:
        raise _translate(exc) from None
    return StreamingResponse(
        generation_events(prepared),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{conversation_id}/regenerate/stream")
async def regenerate_message(
    session: SessionDep,
    conversation_id: str,
    body: ModelTestRegenerateIn,
) -> StreamingResponse:
    try:
        prepared = await ModelTestService(session).prepare_regenerate(
            conversation_id, body.expected_revision
        )
    except (
        ResourceNotFoundError,
        ModelUnavailableError,
        ConversationBusyError,
        RegenerateUnavailableError,
    ) as exc:
        raise _translate(exc) from None
    return StreamingResponse(
        generation_events(prepared),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
