from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.deps import SessionDep
from app.llm.playground.transcription import (
    ModelTestTranscription,
    ModelTestTranscriptionError,
)
from app.schemas.model_test import (
    ModelTestTranscriptionCreateIn,
    ModelTestTranscriptionOptionListOut,
    ModelTestTranscriptionTaskListOut,
    ModelTestTranscriptionTaskOut,
)

router = APIRouter(prefix="/model-test", tags=["model-test"])


def _translate(exc: ModelTestTranscriptionError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/transcription-options", response_model=ModelTestTranscriptionOptionListOut)
async def transcription_options(session: SessionDep) -> ModelTestTranscriptionOptionListOut:
    return await ModelTestTranscription(session).options()


@router.post("/transcription-tasks/upload", response_model=ModelTestTranscriptionTaskOut)
async def upload_transcription_task(
    session: SessionDep,
    upload: Annotated[UploadFile, File()],
    model_id: Annotated[str, Form()],
    language: Annotated[Literal["auto", "zh", "ja"], Form()] = "auto",
) -> ModelTestTranscriptionTaskOut:
    try:
        return await ModelTestTranscription(session).create_upload(
            upload, model_id=model_id, language=language
        )
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None


@router.post("/transcription-tasks", response_model=ModelTestTranscriptionTaskOut)
async def create_transcription_task(
    session: SessionDep, body: ModelTestTranscriptionCreateIn
) -> ModelTestTranscriptionTaskOut:
    try:
        return await ModelTestTranscription(session).create_from_library(body)
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None


@router.get("/transcription-tasks", response_model=ModelTestTranscriptionTaskListOut)
async def list_transcription_tasks(
    session: SessionDep,
    model_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> ModelTestTranscriptionTaskListOut:
    return await ModelTestTranscription(session).list(
        model_id=model_id, page=page, page_size=page_size
    )


@router.get("/transcription-tasks/{task_id}", response_model=ModelTestTranscriptionTaskOut)
async def get_transcription_task(
    session: SessionDep, task_id: str
) -> ModelTestTranscriptionTaskOut:
    try:
        return await ModelTestTranscription(session).get(task_id)
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None


@router.get("/transcription-tasks/{task_id}/input-content")
async def transcription_input_content(session: SessionDep, task_id: str) -> FileResponse:
    try:
        row, path = await ModelTestTranscription(session).content(task_id)
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
    task_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await ModelTestTranscription(session).delete(task_id, expected_revision)
    except ModelTestTranscriptionError as exc:
        raise _translate(exc) from None
    return {"deleted": True}
