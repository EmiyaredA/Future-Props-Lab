from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError

from studio.apps.audio_annotation.schemas.document import (
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
from studio.apps.audio_annotation.schemas.operations import (
    AnnotationOperationsIn,
    SavedSegmentTranscriptionIn,
)
from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.apps.audio_annotation.transport.dependencies import (
    CreatorDep,
    DeleterDep,
    DocumentEditorDep,
    ProjectsDep,
    SavedAudioDep,
    TranscriberDep,
)
from studio.assembly.http_dependencies import StudioAuth
from studio.runtime.database.operation_receipts import OperationError

router = APIRouter(prefix="/audio-annotation", tags=["audio-annotation"])
BINARY = {
    200: {
        "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}
    }
}


def _error(exc: AudioAnnotationError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


async def mapped_operation(operation):
    try:
        return await operation
    except (OperationError, AudioAnnotationError) as exc:
        raise _error(exc) from None
    except ValidationError as exc:
        raise HTTPException(
            422, {"code": "invalid_operation_result", "errors": exc.errors(include_context=False)}
        ) from None


async def call_export(operation):
    try:
        return await operation
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.get("/projects", response_model=AudioAnnotationProjectListOut)
async def list_projects(
    projects: ProjectsDep, query: str = Query(default="", max_length=255)
) -> AudioAnnotationProjectListOut:
    return await projects.list(query.strip())


@router.post("/projects", response_model=AudioAnnotationProjectOut)
async def create_project(
    projects: CreatorDep, body: AudioAnnotationProjectCreateIn
) -> AudioAnnotationProjectOut:
    try:
        return await projects.create(body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.post("/imports", response_model=AudioAnnotationProjectOut)
async def import_project(
    projects: CreatorDep, body: AudioAnnotationImportIn
) -> AudioAnnotationProjectOut:
    try:
        return await projects.import_project(body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.post("/transcription-imports", response_model=AudioAnnotationProjectOut)
async def import_transcription(
    projects: CreatorDep, body: AudioAnnotationTranscriptionImportIn
) -> AudioAnnotationProjectOut:
    try:
        return await projects.import_transcription(body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}", response_model=AudioAnnotationProjectOut)
async def get_project(projects: ProjectsDep, project_id: str) -> AudioAnnotationProjectOut:
    try:
        return await projects.get(project_id)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.patch("/projects/{project_id}", response_model=AudioAnnotationProjectOut)
async def patch_project(
    projects: ProjectsDep,
    project_id: str,
    body: AudioAnnotationProjectPatchIn,
) -> AudioAnnotationProjectOut:
    try:
        return await projects.patch(project_id, body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    projects: DeleterDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await projects.execute(project_id, expected_revision)
    except AudioAnnotationError as exc:
        raise _error(exc) from None
    return {"deleted": True}


@router.get(
    "/projects/{project_id}/document",
    response_model=AudioAnnotationDocumentOut,
)
async def get_document(projects: ProjectsDep, project_id: str) -> AudioAnnotationDocumentOut:
    try:
        return await projects.get_document(project_id)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.put(
    "/projects/{project_id}/document",
    response_model=AudioAnnotationDocumentOut,
)
async def put_document(
    projects: ProjectsDep,
    project_id: str,
    body: AudioAnnotationDocumentPutIn,
) -> AudioAnnotationDocumentOut:
    try:
        return await projects.put_document(project_id, body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.post(
    "/projects/{project_id}/document/operations",
    response_model=AudioAnnotationDocumentOut,
)
async def apply_annotation_operations(
    project_id: str, body: AnnotationOperationsIn, editor: DocumentEditorDep
):
    return await mapped_operation(editor.execute(project_id, body))


@router.get("/projects/{project_id}/export", response_class=Response, responses=BINARY)
async def export_annotation(
    audio: SavedAudioDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
    format: Literal["json", "srt"] = "json",
):
    content, mime, filename = await call_export(audio.export(project_id, expected_revision, format))
    return Response(
        content,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/projects/{project_id}/segments/{segment_id}/audio", response_class=Response, responses=BINARY
)
async def download_segment_audio(
    audio: SavedAudioDep,
    project_id: str,
    segment_id: str,
    expected_revision: int = Query(ge=0),
):
    content, _ = await call_export(audio.clip(project_id, segment_id, expected_revision))
    return Response(
        content,
        media_type="audio/wav",
        headers={"Content-Disposition": 'attachment; filename="segment.wav"'},
    )


@router.post(
    "/projects/{project_id}/segments/{segment_id}/transcribe-saved",
    response_model=AudioAnnotationSegmentTranscriptionOut,
)
async def transcribe_saved_segment(
    audio: SavedAudioDep,
    project_id: str,
    segment_id: str,
    body: SavedSegmentTranscriptionIn,
):
    return await call_export(audio.transcribe(project_id, segment_id, body))


@router.post(
    "/projects/{project_id}/segment-transcriptions",
    response_model=AudioAnnotationSegmentTranscriptionOut,
)
async def transcribe_segment(
    transcriber: TranscriberDep,
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
        return await transcriber(
            project_id,
            upload=upload,
            model_id=model_id,
            segment_id=segment_id,
            start_ms=start_ms,
            end_ms=end_ms,
            language_tag=language_tag,
            target_language_tag=target_language_tag,
            principal=principal,
        )
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.get(
    "/projects/{project_id}/waveform",
    response_model=AudioAnnotationWaveformOut,
)
async def get_waveform(projects: ProjectsDep, project_id: str) -> AudioAnnotationWaveformOut:
    try:
        return await projects.get_waveform(project_id)
    except AudioAnnotationError as exc:
        raise _error(exc) from None


@router.put(
    "/projects/{project_id}/waveform",
    response_model=AudioAnnotationWaveformOut,
)
async def put_waveform(
    projects: ProjectsDep,
    project_id: str,
    body: AudioAnnotationWaveformPutIn,
) -> AudioAnnotationWaveformOut:
    try:
        return await projects.put_waveform(project_id, body)
    except AudioAnnotationError as exc:
        raise _error(exc) from None
