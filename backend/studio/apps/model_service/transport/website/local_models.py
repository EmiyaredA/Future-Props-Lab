from fastapi import APIRouter, HTTPException, Request

from studio.apps.model_service.catalog.http_bindings import CatalogDep
from studio.apps.model_service.local_models.authorization import (
    LocalModelActionAuthorization,
    can_manage_local_models,
    manage_local_model,
)
from studio.apps.model_service.transport.errors import mapped
from studio.assembly.http_dependencies import StudioAuth
from studio.config.local_models import FFMPEG_MODEL_ID, LOCAL_VIDEO_MODEL_IDS, RELAY_MODEL_ID
from studio.contracts.model_service.schemas.local_models import (
    LocalModelActionIn,
    LocalModelAttachIn,
    LocalModelOut,
    LocalModelsOut,
)
from studio.contracts.model_service.schemas.model_service import ModelCatalogOut
from studio.runtime.http.website import require_local_browser

router = APIRouter(tags=["local-models"])


@router.get("/local-models", response_model=LocalModelsOut)
async def list_models(request: Request, principal: StudioAuth):
    can_manage = can_manage_local_models(principal)
    actor = getattr(request.state, "service_actor", None)
    if actor is not None:
        can_manage = can_manage and actor.local
    return await request.app.state.local_models.list(can_manage)


@router.post("/platform/local-models/{model_id}/actions", response_model=LocalModelOut)
async def model_action(
    model_id: str, body: LocalModelActionIn, request: Request, principal: StudioAuth
):
    if model_id in LOCAL_VIDEO_MODEL_IDS:
        require_local_browser(request, principal)
    return await mapped(
        manage_local_model(
            request.app.state.local_models,
            principal,
            model_id,
            body,
            authorization=LocalModelActionAuthorization(
                owner_user_id=principal.user_id,
                assertion=getattr(request.state, "service_assertion", ""),
                method=request.method,
                path=request.url.path,
            ),
        )
    )


@router.post("/local-models/attach", response_model=ModelCatalogOut)
async def attach_model(
    body: LocalModelAttachIn, catalog: CatalogDep, request: Request, principal: StudioAuth
):
    if body.model_id in LOCAL_VIDEO_MODEL_IDS:
        require_local_browser(request, principal)
        installer = getattr(request.app.state.local_models, "installer", None)
        if installer is None:
            raise HTTPException(409, detail="视频增强仅在桌面本机提供")
        if body.model_id == RELAY_MODEL_ID and not installer.relay_available():
            raise HTTPException(409, detail="需要完成本机 Metal 验收")
        if body.model_id == FFMPEG_MODEL_ID and not installer.fast_video_available():
            raise HTTPException(409, detail="本机 FFmpeg 编码环境不可用")
    return await mapped(catalog.attach_local_model(body))
