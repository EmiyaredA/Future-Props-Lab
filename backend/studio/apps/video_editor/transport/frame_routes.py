"""The existing Video Editor still and text layer routes on the independent service."""

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from studio.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from studio.apps.video_editor.frame_requests import FrameRequests
from studio.apps.video_editor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter()


@router.get("/projects/{project_id}/preview/frame")
async def exact_frame(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    revision: int = Query(ge=0),
    time_us: int = Query(alias="timeUs", ge=0),
    width: int = Query(default=960, ge=320, le=1920),
    without_chroma_clip_id: str | None = Query(default=None, alias="withoutChromaClipId"),
) -> Response:
    try:
        png = await FrameRequests(request, session, owner_user_id).frame(
            project_id,
            revision,
            time_us,
            width,
            without_chroma_clip_id,
        )
    except (
        VideoEditorNotFoundError,
        VideoEditorValidationError,
        VideoEditorUnavailableError,
    ) as exc:
        raise _error(exc) from None
    return Response(
        png,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.get(
    "/projects/{project_id}/text-clips/{clip_id}/layer",
    response_class=Response,
    responses={200: {"content": {"image/png": {"schema": {"type": "string", "format": "binary"}}}}},
)
async def text_clip_layer(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    clip_id: str,
    revision: int = Query(ge=0),
) -> Response:
    try:
        png = await FrameRequests(request, session, owner_user_id).text(
            project_id, clip_id, revision
        )
    except (
        VideoEditorNotFoundError,
        VideoEditorValidationError,
        VideoEditorUnavailableError,
    ) as exc:
        raise _error(exc) from None
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, no-cache"})
