from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from studio.apps.model_service.catalog.service import ResourceNotFoundError
from studio.apps.model_service.playground.attachments import AttachmentError, ModelTestAttachments
from studio.apps.model_service.playground.service import (
    ConversationBusyError,
    ModelTestService,
    ModelUnavailableError,
    RegenerateUnavailableError,
)
from studio.apps.model_service.playground.stream import generation_events
from studio.apps.model_service.transport.provider_bindings import provider_options
from studio.apps.model_service.transport.stream_access import stream_access
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.assembly.model_credentials import CallCredentialDep
from studio.contracts.model_service.schemas.model_test import (
    ModelTestAttachmentListOut,
    ModelTestConversationCreateIn,
    ModelTestConversationListOut,
    ModelTestConversationOut,
    ModelTestConversationPatchIn,
    ModelTestRegenerateIn,
    ModelTestSendIn,
)
from studio.runtime.files.image_sizes import ThumbnailSize

router = APIRouter(prefix="/model-test/conversations", tags=["model-test"])


def _service(session: SessionDep, owner_user_id: str, request: Request) -> ModelTestService:
    return ModelTestService(session, owner_user_id, request.app.state.settings)


def _attachments(session: SessionDep, owner_user_id: str, request: Request) -> ModelTestAttachments:
    return ModelTestAttachments(session, request.app.state.settings, owner_user_id)


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
    request: Request, session: SessionDep, owner_user_id: OwnerDep
) -> ModelTestConversationListOut:
    return await _service(session, owner_user_id, request).list()


@router.post("", response_model=ModelTestConversationOut)
async def create_conversation(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: ModelTestConversationCreateIn,
) -> ModelTestConversationOut:
    try:
        return await _service(session, owner_user_id, request).create(body)
    except ModelUnavailableError as exc:
        raise _translate(exc) from None


@router.get("/{conversation_id}", response_model=ModelTestConversationOut)
async def get_conversation(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, conversation_id: str
) -> ModelTestConversationOut:
    try:
        return await _service(session, owner_user_id, request).get(conversation_id)
    except ResourceNotFoundError as exc:
        raise _translate(exc) from None


@router.patch("/{conversation_id}", response_model=ModelTestConversationOut)
async def patch_conversation(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    body: ModelTestConversationPatchIn,
) -> ModelTestConversationOut:
    try:
        return await _service(session, owner_user_id, request).patch(conversation_id, body)
    except (ResourceNotFoundError, ModelUnavailableError, ConversationBusyError) as exc:
        raise _translate(exc) from None


@router.delete("/{conversation_id}")
async def delete_conversation(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await _service(session, owner_user_id, request).delete(conversation_id, expected_revision)
    except (ResourceNotFoundError, ConversationBusyError) as exc:
        raise _translate(exc) from None
    return {"deleted": True}


@router.post("/{conversation_id}/attachments", response_model=ModelTestAttachmentListOut)
async def upload_attachments(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    files: Annotated[list[UploadFile], File()],
) -> ModelTestAttachmentListOut:
    try:
        return await _attachments(session, owner_user_id, request).upload(conversation_id, files)
    except AttachmentError as exc:
        raise _translate(exc) from None


@router.delete("/{conversation_id}/attachments/{attachment_id}")
async def delete_attachment(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    attachment_id: str,
) -> dict[str, bool]:
    try:
        await _attachments(session, owner_user_id, request).delete_draft(
            conversation_id, attachment_id
        )
    except AttachmentError as exc:
        raise _translate(exc) from None
    return {"deleted": True}


@router.get("/{conversation_id}/attachments/{attachment_id}/content")
async def attachment_content(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    conversation_id: str,
    attachment_id: str,
    size: ThumbnailSize | None = None,
) -> FileResponse:
    try:
        row, path = await _attachments(session, owner_user_id, request).content(
            conversation_id, attachment_id, size, previews=request.app.state.raster_previews
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
        prepared = await _service(session, owner_user_id, request).prepare_send(
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
            decrypt=request.app.state.model_decrypt,
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
        prepared = await _service(session, owner_user_id, request).prepare_regenerate(
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
            decrypt=request.app.state.model_decrypt,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
