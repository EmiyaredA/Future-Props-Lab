from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from studio.apps.model_service.transport.errors import mapped
from studio.assembly.http_dependencies import StudioAuth
from studio.contracts.model_service.schemas.video_enhancement import (
    VideoEnhancementAction,
    VideoEnhancementIn,
    VideoEnhancementOut,
)
from studio.runtime.http.website import require_local_browser

router = APIRouter(prefix="/model-inference/video-enhancements", tags=["video-enhancement"])
PRIVATE = {"Cache-Control": "private, no-store"}
MP4 = {200: {"content": {"video/mp4": {"schema": {"type": "string", "format": "binary"}}}}}


def service(request, principal):
    require_local_browser(request, principal)
    enhancement = getattr(request.app.state, "video_enhancement", None)
    if enhancement is None:
        raise HTTPException(409, detail="视频增强仅在桌面本机提供")
    return enhancement


@router.post("", response_model=VideoEnhancementOut)
async def create_video_enhancement(
    request: Request, principal: StudioAuth, body: VideoEnhancementIn
):
    return await mapped(service(request, principal).create(principal.user_id, body))


@router.get("", response_model=list[VideoEnhancementOut])
async def list_video_enhancements(request: Request, principal: StudioAuth, model_id: str):
    return await mapped(service(request, principal).list(principal.user_id, model_id))


@router.get("/{task_id}", response_model=VideoEnhancementOut)
async def get_video_enhancement(request: Request, principal: StudioAuth, task_id: str):
    return await mapped(service(request, principal).detail(principal.user_id, task_id))


@router.post("/{task_id}/actions", response_model=VideoEnhancementOut)
async def control_video_enhancement(
    request: Request, principal: StudioAuth, task_id: str, body: VideoEnhancementAction
):
    return await mapped(service(request, principal).action(principal.user_id, task_id, body))


@router.get("/{task_id}/segments/{index}/{variant}", response_class=FileResponse, responses=MP4)
async def get_video_enhancement_segment(
    request: Request,
    principal: StudioAuth,
    task_id: str,
    index: int,
    variant: Literal["original", "enhanced"],
):
    path = await mapped(
        service(request, principal).content(principal.user_id, task_id, index, variant)
    )
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=path.name,
        content_disposition_type="inline",
        headers=PRIVATE,
    )


@router.get("/{task_id}/content", response_class=FileResponse, responses=MP4)
async def get_video_enhancement_result(request: Request, principal: StudioAuth, task_id: str):
    path = await mapped(service(request, principal).content(principal.user_id, task_id))
    return FileResponse(
        path, media_type="video/mp4", filename="enhanced-1080p.mp4", headers=PRIVATE
    )
