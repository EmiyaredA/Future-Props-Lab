"""Queue the published chroma-bake operation through the independent renderer."""

from fastapi import APIRouter, Request

from studio.apps.video_editor.baking.bake_requests import BakeRequests
from studio.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from studio.apps.video_editor.schemas import VideoEditorAssetBakeCreateIn, VideoEditorTaskOut
from studio.apps.video_editor.transport.website.errors import _error
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter()


@router.post("/projects/{project_id}/assets/{asset_id}/bakes", response_model=VideoEditorTaskOut)
async def create_asset_bake(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    asset_id: str,
    body: VideoEditorAssetBakeCreateIn,
) -> VideoEditorTaskOut:
    if request.app.state.render_delivery is None:
        raise _error(VideoEditorUnavailableError("剪辑素材烘焙暂不可用"))
    try:
        return await BakeRequests(request, session, owner_user_id).create(
            project_id, asset_id, body
        )
    except (
        VideoEditorNotFoundError,
        VideoEditorUnavailableError,
        VideoEditorValidationError,
    ) as exc:
        raise _error(exc) from None
