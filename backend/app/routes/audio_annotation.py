from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.audio_annotation import AudioAnnotationError, AudioAnnotationProjects
from app.audio_annotation.transcription import AudioAnnotationTranscription
from app.deps import SessionDep, StudioAuth
from app.llm.call_logs.credentials import snapshot_from_principal
from app.schemas.audio_annotation import (
    STABLE_ID_PATTERN,
    AudioAnnotationDocumentOut,
    AudioAnnotationDocumentPutIn,
    AudioAnnotationImportIn,
    AudioAnnotationProjectCreateIn,
    AudioAnnotationProjectListOut,
    AudioAnnotationProjectOut,
    AudioAnnotationProjectPatchIn,
    AudioAnnotationSegmentTranscriptionOut,
    AudioAnnotationTranscriptionImportIn,
    AudioAnnotationWaveformOut,
    AudioAnnotationWaveformPutIn,
)

router = APIRouter(prefix="/audio-annotation", tags=["audio-annotation"])


def _error(exc: AudioAnnotationError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/projects", response_model=AudioAnnotationProjectListOut)
async def list_projects(
    session: SessionDep, query: str = Query(default="", max_length=255)
) -> AudioAnnotationProjectListOut:
    return await AudioAnnotationProjects(session).list(query.strip())


@router.post("/projects", response_model=AudioAnnotationProjectOut)
async def create_project(
    session: SessionDep, body: AudioAnnotationProjectCreateIn
) -> AudioAnnotationProjectOut:
    try:
        return await AudioAnnotationProjects(session).create(body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.post("/imports", response_model=AudioAnnotationProjectOut)
async def import_project(
    session: SessionDep, body: AudioAnnotationImportIn
) -> AudioAnnotationProjectOut:
    try:
        return await AudioAnnotationProjects(session).import_project(body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.post("/transcription-imports", response_model=AudioAnnotationProjectOut)
async def import_transcription(
    session: SessionDep, body: AudioAnnotationTranscriptionImportIn
) -> AudioAnnotationProjectOut:
    try:
        return await AudioAnnotationProjects(session).import_transcription(body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}", response_model=AudioAnnotationProjectOut)
async def get_project(session: SessionDep, project_id: str) -> AudioAnnotationProjectOut:
    try:
        return await AudioAnnotationProjects(session).get(project_id)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.patch("/projects/{project_id}", response_model=AudioAnnotationProjectOut)
async def patch_project(
    session: SessionDep,
    project_id: str,
    body: AudioAnnotationProjectPatchIn,
) -> AudioAnnotationProjectOut:
    try:
        return await AudioAnnotationProjects(session).patch(project_id, body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    session: SessionDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await AudioAnnotationProjects(session).delete(project_id, expected_revision)
    except AudioAnnotationError as exc:
        raise _error(exc) from None
    return {"deleted": True}


@router.get(
    "/projects/{project_id}/document",
    response_model=AudioAnnotationDocumentOut,
)
async def get_document(session: SessionDep, project_id: str) -> AudioAnnotationDocumentOut:
    try:
        return await AudioAnnotationProjects(session).get_document(project_id)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.put(
    "/projects/{project_id}/document",
    response_model=AudioAnnotationDocumentOut,
)
async def put_document(
    session: SessionDep,
    project_id: str,
    body: AudioAnnotationDocumentPutIn,
) -> AudioAnnotationDocumentOut:
    try:
        return await AudioAnnotationProjects(session).put_document(project_id, body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.post(
    "/projects/{project_id}/segment-transcriptions",
    response_model=AudioAnnotationSegmentTranscriptionOut,
)
async def transcribe_segment(
    session: SessionDep,
    principal: StudioAuth,
    project_id: str,
    upload: Annotated[UploadFile, File()],
    model_id: Annotated[str, Form(min_length=1, max_length=36)],
    segment_id: Annotated[str, Form(pattern=STABLE_ID_PATTERN)],
    start_ms: Annotated[int, Form(ge=0)],
    end_ms: Annotated[int, Form(gt=0)],
    language_tag: Annotated[str | None, Form(max_length=35)] = None,
    target_language_tag: Annotated[str | None, Form(max_length=35)] = None,
) -> AudioAnnotationSegmentTranscriptionOut:
    try:
        credential = await snapshot_from_principal(session, principal)
        return await AudioAnnotationTranscription(session).transcribe(
            project_id,
            upload=upload,
            model_id=model_id,
            segment_id=segment_id,
            start_ms=start_ms,
            end_ms=end_ms,
            language_tag=language_tag,
            target_language_tag=target_language_tag,
            credential=credential,
        )
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.get(
    "/projects/{project_id}/waveform",
    response_model=AudioAnnotationWaveformOut,
)
async def get_waveform(session: SessionDep, project_id: str) -> AudioAnnotationWaveformOut:
    try:
        return await AudioAnnotationProjects(session).get_waveform(project_id)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.put(
    "/projects/{project_id}/waveform",
    response_model=AudioAnnotationWaveformOut,
)
async def put_waveform(
    session: SessionDep,
    project_id: str,
    body: AudioAnnotationWaveformPutIn,
) -> AudioAnnotationWaveformOut:
    try:
        return await AudioAnnotationProjects(session).put_waveform(project_id, body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None
