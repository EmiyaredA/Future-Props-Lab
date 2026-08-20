from fastapi import APIRouter, HTTPException, Query

from app.audio_annotation import AudioAnnotationError, AudioAnnotationProjects
from app.deps import SessionDep
from app.schemas.audio_annotation import (
    AudioAnnotationDocumentOut,
    AudioAnnotationDocumentPutIn,
    AudioAnnotationImportIn,
    AudioAnnotationProjectCreateIn,
    AudioAnnotationProjectListOut,
    AudioAnnotationProjectOut,
    AudioAnnotationProjectPatchIn,
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
