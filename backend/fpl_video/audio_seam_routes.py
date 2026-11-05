"""The existing read-only audio seam candidate operation."""

from fastapi import APIRouter, Request

from app.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from app.apps.video_editor.routes.errors import _error
from app.apps.video_editor.schemas.audio_seam import AudioSeamCandidatesIn, AudioSeamCandidatesOut
from app.deps import OwnerDep, SessionDep

from .audio_seam_requests import candidates

router = APIRouter()


@router.post("/projects/{project_id}/audio-seams/candidates", response_model=AudioSeamCandidatesOut)
async def audio_seam_candidates(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: AudioSeamCandidatesIn,
) -> AudioSeamCandidatesOut:
    try:
        return await candidates(request, session, owner_user_id, project_id, body)
    except (
        VideoEditorNotFoundError,
        VideoEditorUnavailableError,
        VideoEditorValidationError,
    ) as exc:
        raise _error(exc) from None
