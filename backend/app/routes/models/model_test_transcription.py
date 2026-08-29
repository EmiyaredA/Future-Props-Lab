from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.deps import SessionDep, WorkspaceDep
from app.llm.playground.transcription import (
    ModelTestTranscription,
    ModelTestTranscriptionError,
)
from app.schemas.model_test import (
    ModelTestTranscriptionCreateIn,
    ModelTestTranscriptionOptionListOut,
    ModelTestTranscriptionParametersIn,
    ModelTestTranscriptionTaskListOut,
    ModelTestTranscriptionTaskOut,
)

router = APIRouter(prefix="/model-test", tags=["model-test"])


def _transcription(session: SessionDep, workspace_id: str) -> ModelTestTranscription:
    return ModelTestTranscription(session, workspace_id)


def _translate(exc: ModelTestTranscriptionError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/transcription-options", response_model=ModelTestTranscriptionOptionListOut)
async def transcription_options(
    session: SessionDep, workspace_id: WorkspaceDep
) -> ModelTestTranscriptionOptionListOut:
    return await _transcription(session, workspace_id).options()


@router.post("/transcription-tasks/upload", response_model=ModelTestTranscriptionTaskOut)
async def upload_transcription_task(
    session: SessionDep,
    workspace_id: WorkspaceDep,
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
        return await _transcription(session, workspace_id).create_upload(
            upload,
            model_id=model_id,
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
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None


@router.post("/transcription-tasks", response_model=ModelTestTranscriptionTaskOut)
async def create_transcription_task(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    body: ModelTestTranscriptionCreateIn,
) -> ModelTestTranscriptionTaskOut:
    try:
        return await _transcription(session, workspace_id).create_from_library(body)
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None


@router.get("/transcription-tasks", response_model=ModelTestTranscriptionTaskListOut)
async def list_transcription_tasks(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    model_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> ModelTestTranscriptionTaskListOut:
    return await _transcription(session, workspace_id).list(
        model_id=model_id, page=page, page_size=page_size
    )


@router.get("/transcription-tasks/{task_id}", response_model=ModelTestTranscriptionTaskOut)
async def get_transcription_task(
    session: SessionDep, workspace_id: WorkspaceDep, task_id: str
) -> ModelTestTranscriptionTaskOut:
    try:
        return await _transcription(session, workspace_id).get(task_id)
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None


@router.get("/transcription-tasks/{task_id}/input-content")
async def transcription_input_content(
    session: SessionDep, workspace_id: WorkspaceDep, task_id: str
) -> FileResponse:
    try:
        row, path = await _transcription(session, workspace_id).content(task_id)
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
    workspace_id: WorkspaceDep,
    task_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await _transcription(session, workspace_id).delete(task_id, expected_revision)
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None
    return {"deleted": True}
