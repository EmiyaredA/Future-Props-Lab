from fastapi import APIRouter, Depends

from app.deps import require_studio_auth
from app.routes import annotation_exports, image_crop, thought_conversion, video_frames
from app.routes.account_management import router as management_router
from app.routes.accounts import router as accounts_router
from app.routes.audio_annotation import router as audio_annotation_router
from app.routes.demo_runtime import call_router as demo_call_router
from app.routes.demo_runtime import router as demo_runtime_router
from app.routes.file_management import router as file_management_router
from app.routes.galgame_workshop import router as galgame_workshop_router
from app.routes.integrations import router as integrations_router
from app.routes.model_capacity import ModelCapacity
from app.routes.model_inference import router as model_inference_router
from app.routes.model_templates import router as model_templates_router
from app.routes.models import (
    call_logs,
    catalog,
    model_test,
    model_test_generation,
    model_test_realtime,
    model_test_tools,
    model_test_transcription,
    suppliers,
)
from app.routes.platform_governance import router as platform_governance_router
from app.routes.presentation_workshop import router as presentation_workshop_router
from app.routes.public_workspace import router as public_workspace_router
from app.routes.thought_workshop import router as thought_workshop_router
from app.routes.tool_navigation import router as tool_navigation_router
from app.routes.video_editor import router as video_editor_router
from app.routes.visual_assistant import router as visual_assistant_router
from app.routes.visual_generation import router as visual_generation_router
from app.routes.visual_workshop import router as visual_workshop_router
from app.routes.workshop_operations import router as workshop_operations_router
from app.routes.workspaces import invitation_router
from app.routes.workspaces import router as workspaces_router

api_router = APIRouter(prefix="/v1")
api_router.include_router(accounts_router)
api_router.include_router(demo_runtime_router)
api_router.include_router(demo_call_router)
api_router.include_router(platform_governance_router)
api_router.include_router(model_templates_router)
api_router.include_router(management_router)
api_router.include_router(workspaces_router)
api_router.include_router(invitation_router)
api_router.include_router(public_workspace_router)
api_router.include_router(
    catalog.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    suppliers.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    call_logs.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    model_test.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    model_test_tools.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    model_test_generation.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(model_test_realtime.router)
api_router.include_router(
    model_test_transcription.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    tool_navigation_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    integrations_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    audio_annotation_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    file_management_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    visual_workshop_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    visual_assistant_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    visual_generation_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    galgame_workshop_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    video_editor_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(
    thought_workshop_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(
    presentation_workshop_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(
    workshop_operations_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(
    model_inference_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(
    annotation_exports.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(
    thought_conversion.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(
    video_frames.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(
    image_crop.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
