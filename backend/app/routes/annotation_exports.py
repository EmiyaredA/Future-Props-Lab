from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.audio_annotation.exports import clip, export_document, transcribe_saved
from app.audio_annotation.projects import AudioAnnotationError
from app.deps import SessionDep
from app.schemas.annotation_operations import SavedSegmentTranscriptionIn
from app.schemas.audio_annotation import AudioAnnotationSegmentTranscriptionOut

router = APIRouter(prefix="/audio-annotation", tags=["audio-annotation"])
BINARY = {
    200: {
        "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}
    }
}


async def call(operation):
    try:
        return await operation
    except AudioAnnotationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/projects/{project_id}/export", response_class=Response, responses=BINARY)
async def export_annotation(
    session: SessionDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
    format: Literal["json", "srt"] = "json",
):
    content, mime, filename = await call(
        export_document(session, project_id, expected_revision, format)
    )
    return Response(
        content,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/projects/{project_id}/segments/{segment_id}/audio", response_class=Response, responses=BINARY
)
async def download_segment_audio(
    session: SessionDep, project_id: str, segment_id: str, expected_revision: int = Query(ge=0)
):
    content, _ = await call(clip(session, project_id, segment_id, expected_revision))
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
    session: SessionDep, project_id: str, segment_id: str, body: SavedSegmentTranscriptionIn
):
    return await call(transcribe_saved(session, project_id, segment_id, body))
