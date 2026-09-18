from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from app.deps import SessionDep, StudioAuth, WorkspaceDep
from app.llm.call_logs.credentials import snapshot_from_principal
from app.llm.catalog.service import ResourceNotFoundError
from app.llm.playground.attachments import AttachmentError, ModelTestAttachments
from app.llm.playground.service import (
    ConversationBusyError,
    ModelTestService,
    ModelUnavailableError,
    RegenerateUnavailableError,
)
from app.llm.playground.stream import generation_events
from app.llm.schemas.model_test import (
    ModelTestAttachmentListOut,
    ModelTestConversationCreateIn,
    ModelTestConversationListOut,
    ModelTestConversationOut,
    ModelTestConversationPatchIn,
    ModelTestRegenerateIn,
    ModelTestSendIn,
)
from app.runtime.config import get_settings

router = APIRouter(prefix="/model-test/conversations", tags=["model-test"])


def _service(session: SessionDep, workspace_id: str) -> ModelTestService:
    return ModelTestService(session, workspace_id)


def _attachments(session: SessionDep, workspace_id: str) -> ModelTestAttachments:
    return ModelTestAttachments(session, get_settings(), workspace_id)


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
    session: SessionDep, workspace_id: WorkspaceDep
) -> ModelTestConversationListOut:
    return await _service(session, workspace_id).list()


@router.post("", response_model=ModelTestConversationOut)
async def create_conversation(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    body: ModelTestConversationCreateIn,
) -> ModelTestConversationOut:
    try:
        return await _service(session, workspace_id).create(body)
    except ModelUnavailableError as exc:
        raise _translate(exc) from None


@router.get("/{conversation_id}", response_model=ModelTestConversationOut)
async def get_conversation(
    session: SessionDep, workspace_id: WorkspaceDep, conversation_id: str
) -> ModelTestConversationOut:
    try:
        return await _service(session, workspace_id).get(conversation_id)
    except ResourceNotFoundError as exc:
        raise _translate(exc) from None


@router.patch("/{conversation_id}", response_model=ModelTestConversationOut)
async def patch_conversation(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    conversation_id: str,
    body: ModelTestConversationPatchIn,
) -> ModelTestConversationOut:
    try:
        return await _service(session, workspace_id).patch(conversation_id, body)
    except (ResourceNotFoundError, ModelUnavailableError, ConversationBusyError) as exc:
        raise _translate(exc) from None


@router.delete("/{conversation_id}")
async def delete_conversation(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    conversation_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await _service(session, workspace_id).delete(conversation_id, expected_revision)
    except (ResourceNotFoundError, ConversationBusyError) as exc:
        raise _translate(exc) from None
    return {"deleted": True}


@router.post("/{conversation_id}/attachments", response_model=ModelTestAttachmentListOut)
async def upload_attachments(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    conversation_id: str,
    files: Annotated[list[UploadFile], File()],
) -> ModelTestAttachmentListOut:
    try:
        return await _attachments(session, workspace_id).upload(conversation_id, files)
    except AttachmentError as exc:
        raise _translate(exc) from None


@router.delete("/{conversation_id}/attachments/{attachment_id}")
async def delete_attachment(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    conversation_id: str,
    attachment_id: str,
) -> dict[str, bool]:
    try:
        await _attachments(session, workspace_id).delete_draft(conversation_id, attachment_id)
    except AttachmentError as exc:
        raise _translate(exc) from None
    return {"deleted": True}


@router.get("/{conversation_id}/attachments/{attachment_id}/content")
async def attachment_content(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    conversation_id: str,
    attachment_id: str,
) -> FileResponse:
    try:
        row, path = await _attachments(session, workspace_id).content(
            conversation_id, attachment_id
        )
    except AttachmentError as exc:
        raise _translate(exc) from None
    return FileResponse(
        path,
        media_type=row.mime_type,
        filename=row.original_filename,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/{conversation_id}/messages/stream")
async def stream_message(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    conversation_id: str,
    body: ModelTestSendIn,
    principal: StudioAuth,
) -> StreamingResponse:
    try:
        credential = await snapshot_from_principal(session, principal)
        prepared = await _service(session, workspace_id).prepare_send(
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
        generation_events(prepared),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{conversation_id}/regenerate/stream")
async def regenerate_message(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    conversation_id: str,
    body: ModelTestRegenerateIn,
    principal: StudioAuth,
) -> StreamingResponse:
    try:
        credential = await snapshot_from_principal(session, principal)
        prepared = await _service(session, workspace_id).prepare_regenerate(
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
        generation_events(prepared),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
