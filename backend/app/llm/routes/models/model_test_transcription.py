from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from app.llm.library_inputs import library_inputs
from app.llm.playground.transcription import (
    ModelTestTranscription,
    ModelTestTranscriptionError,
)
from app.llm.routes.model_capacity import task_admission
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.assembly.model_credentials import CallCredentialDep
from studio.contracts.model_service.schemas.model_test import (
    ModelTestTranscriptionCreateIn,
    ModelTestTranscriptionOptionListOut,
    ModelTestTranscriptionParametersIn,
    ModelTestTranscriptionTaskListOut,
    ModelTestTranscriptionTaskOut,
)

router = APIRouter(prefix="/model-test", tags=["model-test"])


def _transcription(session: SessionDep, owner_user_id: str) -> ModelTestTranscription:
    return ModelTestTranscription(session, owner_user_id)


def _translate(exc: ModelTestTranscriptionError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/transcription-options", response_model=ModelTestTranscriptionOptionListOut)
async def transcription_options(
    session: SessionDep, owner_user_id: OwnerDep
) -> ModelTestTranscriptionOptionListOut:
    return await _transcription(session, owner_user_id).options()


@router.post("/transcription-tasks/upload", response_model=ModelTestTranscriptionTaskOut)
async def upload_transcription_task(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    credential: CallCredentialDep,
    upload: Annotated[UploadFile, File()],
    model_id: Annotated[str, Form()],
    language: Annotated[str | None, Form()] = None,
    target_language: Annotated[str | None, Form()] = None,
    enable_word_timestamps: Annotated[bool | None, Form()] = None,
    enable_text_edit: Annotated[bool | None, Form()] = None,
    enable_speaker_diarization: Annotated[bool | None, Form()] = None,
    max_speakers: Annotated[int | None, Form(ge=1, le=20)] = None,
    enable_punctuation: Annotated[bool | None, Form()] = None,
    hotwords: Annotated[str | None, Form()] = None,
    abbreviations: Annotated[bool | None, Form()] = None,
) -> ModelTestTranscriptionTaskOut:
    try:
        result = await _transcription(session, owner_user_id).create_upload(
            upload,
            model_id=model_id,
            admission=task_admission(request, session, "transcription"),
            credential=credential,
            parameters=ModelTestTranscriptionParametersIn(
                language=language,
                target_language=target_language,
                enable_word_timestamps=enable_word_timestamps,
                enable_text_edit=enable_text_edit,
                enable_speaker_diarization=enable_speaker_diarization,
                max_speakers=max_speakers,
                enable_punctuation=enable_punctuation,
                hotwords=hotwords,
                abbreviations=abbreviations,
            ),
        )
        return result
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None


@router.post("/transcription-tasks", response_model=ModelTestTranscriptionTaskOut)
async def create_transcription_task(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: ModelTestTranscriptionCreateIn,
    credential: CallCredentialDep,
) -> ModelTestTranscriptionTaskOut:
    try:
        result = await ModelTestTranscription(
            session, owner_user_id, library=library_inputs(request, session, owner_user_id)
        ).create_from_library(
            body,
            admission=task_admission(request, session, "transcription"),
            credential=credential,
        )
        return result
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None


@router.get("/transcription-tasks", response_model=ModelTestTranscriptionTaskListOut)
async def list_transcription_tasks(
    session: SessionDep,
    owner_user_id: OwnerDep,
    model_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> ModelTestTranscriptionTaskListOut:
    return await _transcription(session, owner_user_id).list(
        model_id=model_id, page=page, page_size=page_size
    )


@router.get("/transcription-tasks/{task_id}", response_model=ModelTestTranscriptionTaskOut)
async def get_transcription_task(
    session: SessionDep, owner_user_id: OwnerDep, task_id: str
) -> ModelTestTranscriptionTaskOut:
    try:
        return await _transcription(session, owner_user_id).get(task_id)
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None


@router.get("/transcription-tasks/{task_id}/input-content")
async def transcription_input_content(
    session: SessionDep, owner_user_id: OwnerDep, task_id: str
) -> FileResponse:
    try:
        row, path = await _transcription(session, owner_user_id).content(task_id)
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None
    return FileResponse(
        path,
        media_type=row.input_mime_type,
        filename=row.input_filename,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/transcription-tasks/{task_id}")
async def delete_transcription_task(
    session: SessionDep,
    owner_user_id: OwnerDep,
    task_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await _transcription(session, owner_user_id).delete(task_id, expected_revision)
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None
    return {"deleted": True}
