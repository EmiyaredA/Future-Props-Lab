from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from app.deps import OwnerDep, SessionDep
from app.llm.catalog.service import ResourceNotFoundError
from app.llm.http_credentials import CallCredentialDep
from app.llm.playground.attachments import AttachmentError, ModelTestAttachments
from app.llm.playground.service import (
    ConversationBusyError,
    ModelTestService,
    ModelUnavailableError,
    RegenerateUnavailableError,
)
from app.llm.playground.stream import generation_events
from app.llm.provider_transports import provider_options
from app.llm.schemas.model_test import (
    ModelTestAttachmentListOut,
    ModelTestConversationCreateIn,
    ModelTestConversationListOut,
    ModelTestConversationOut,
    ModelTestConversationPatchIn,
    ModelTestRegenerateIn,
    ModelTestSendIn,
)
from app.llm.stream_access import stream_access
from app.runtime.config import get_settings
from app.runtime.image_sizes import ThumbnailSize

router = APIRouter(prefix="/model-test/conversations", tags=["model-test"])


def _service(session: SessionDep, owner_user_id: str) -> ModelTestService:
    return ModelTestService(session, owner_user_id)


def _attachments(session: SessionDep, owner_user_id: str) -> ModelTestAttachments:
    return ModelTestAttachments(session, get_settings(), owner_user_id)


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, AttachmentError):
        return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
    if isinstance(exc, ResourceNotFoundError):
        return HTTPException(404, {"code": "not_found", "message": str(exc)})
    if isinstance(exc, ModelUnavailableError):
        return HTTPException(409, {"code": "model_unavailable", "message": str(exc)})
    if isinstance(exc, ConversationBusyError):
        return HTTPException(409, {"code": "conversation_busy", "message": str(exc)})
    return HTTPException(409, {"code": "regenerate_unavailable", "message": str(exc)})


@router.get("", response_model=ModelTestConversationListOut)
async def list_conversations(
    session: SessionDep, owner_user_id: OwnerDep
) -> ModelTestConversationListOut:
    return await _service(session, owner_user_id).list()


@router.post("", response_model=ModelTestConversationOut)
async def create_conversation(
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: ModelTestConversationCreateIn,
) -> ModelTestConversationOut:
    try:
        return await _service(session, owner_user_id).create(body)
    except ModelUnavailableError as exc:
        raise _translate(exc) from None


@router.get("/{conversation_id}", response_model=ModelTestConversationOut)
async def get_conversation(
    session: SessionDep, owner_user_id: OwnerDep, conversation_id: str
) -> ModelTestConversationOut:
    try:
        return await _service(session, owner_user_id).get(conversation_id)
    except ResourceNotFoundError as exc:
        raise _translate(exc) from None


@router.patch("/{conversation_id}", response_model=ModelTestConversationOut)
async def patch_conversation(
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    body: ModelTestConversationPatchIn,
) -> ModelTestConversationOut:
    try:
        return await _service(session, owner_user_id).patch(conversation_id, body)
    except (ResourceNotFoundError, ModelUnavailableError, ConversationBusyError) as exc:
        raise _translate(exc) from None


@router.delete("/{conversation_id}")
async def delete_conversation(
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await _service(session, owner_user_id).delete(conversation_id, expected_revision)
    except (ResourceNotFoundError, ConversationBusyError) as exc:
        raise _translate(exc) from None
    return {"deleted": True}


@router.post("/{conversation_id}/attachments", response_model=ModelTestAttachmentListOut)
async def upload_attachments(
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    files: Annotated[list[UploadFile], File()],
) -> ModelTestAttachmentListOut:
    try:
        return await _attachments(session, owner_user_id).upload(conversation_id, files)
    except AttachmentError as exc:
        raise _translate(exc) from None


@router.delete("/{conversation_id}/attachments/{attachment_id}")
async def delete_attachment(
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    attachment_id: str,
) -> dict[str, bool]:
    try:
        await _attachments(session, owner_user_id).delete_draft(conversation_id, attachment_id)
    except AttachmentError as exc:
        raise _translate(exc) from None
    return {"deleted": True}


@router.get("/{conversation_id}/attachments/{attachment_id}/content")
async def attachment_content(
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    attachment_id: str,
    size: ThumbnailSize | None = None,
) -> FileResponse:
    try:
        row, path = await _attachments(session, owner_user_id).content(
            conversation_id, attachment_id, size
        )
    except AttachmentError as exc:
        raise _translate(exc) from None
    return FileResponse(
        path,
        media_type="image/webp" if size is not None else row.mime_type,
        filename=row.original_filename,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/{conversation_id}/messages/stream")
async def stream_message(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    body: ModelTestSendIn,
    credential: CallCredentialDep,
) -> StreamingResponse:
    try:
        prepared = await _service(session, owner_user_id).prepare_send(
            conversation_id,
            body.expected_revision,
            body.content,
            body.attachment_ids,
            credential=credential,
        )
    except (
        ResourceNotFoundError,
        ModelUnavailableError,
        ConversationBusyError,
        AttachmentError,
    ) as exc:
        raise _translate(exc) from None
    return StreamingResponse(
        generation_events(
            prepared,
            session_factory=request.app.state.database.sessions,
            check_access=stream_access(request),
            transport_options=provider_options(request, prepared.base_url),
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{conversation_id}/regenerate/stream")
async def regenerate_message(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    body: ModelTestRegenerateIn,
    credential: CallCredentialDep,
) -> StreamingResponse:
    try:
        prepared = await _service(session, owner_user_id).prepare_regenerate(
            conversation_id, body.expected_revision, credential=credential
        )
    except (
        ResourceNotFoundError,
        ModelUnavailableError,
        ConversationBusyError,
        RegenerateUnavailableError,
        AttachmentError,
    ) as exc:
        raise _translate(exc) from None
    return StreamingResponse(
        generation_events(
            prepared,
            session_factory=request.app.state.database.sessions,
            check_access=stream_access(request),
            transport_options=provider_options(request, prepared.base_url),
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
