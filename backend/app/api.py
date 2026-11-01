from fastapi import APIRouter, Depends

from app.apps.audio_annotation.routes import router as audio_annotation_router
from app.apps.desktop_pet.routes import router as desktop_pet_router
from app.apps.director_desk.routes import router as director_desk_router
from app.apps.galgame_workshop.routes import router as galgame_workshop_router
from app.apps.interview_assistant.routes import router as interview_assistant_router
from app.apps.live2d_workshop.routes import router as live2d_router
from app.apps.motion_compositor.routes import router as motion_compositor_router
from app.apps.presentation_workshop.routes import router as presentation_workshop_router
from app.apps.thought_workshop.routes import conversion as thought_conversion
from app.apps.thought_workshop.routes import router as thought_workshop_router
from app.apps.thought_workshop.routes.community import router as community_router
from app.apps.thought_workshop.routes.community_tables import router as community_tables_router
from app.apps.thought_workshop.routes.external_sync import router as article_sync_router
from app.apps.video_editor.assistant_operations import apply_assistant_timeline_batch
from app.apps.video_editor.routes import router as video_editor_router
from app.apps.visual_workshop.acceptance.routes import router as visual_acceptance_router
from app.apps.visual_workshop.routes import router as visual_workshop_router
from app.apps.visual_workshop.routes.assistant import router as visual_assistant_router
from app.apps.visual_workshop.routes.generation import router as visual_generation_router
from app.apps.visual_workshop.routes.outputs import router as visual_outputs_router
from app.capabilities.asset_store.routes import image_crop, media_info, video_frames
from app.console.amadeus.actions import register_video_executor
from app.console.routes.account_management import router as management_router
from app.console.routes.accounts import router as accounts_router
from app.console.routes.amadeus import require_amadeus_session
from app.console.routes.amadeus import router as amadeus_router
from app.console.routes.code_agents import router as code_agents_router
from app.console.routes.creative_workshop import router as creative_workshop_router
from app.console.routes.desktop import require_desktop
from app.console.routes.desktop import router as desktop_router
from app.console.routes.desktop_agent import router as desktop_agent_router
from app.console.routes.file_management import router as file_management_router
from app.console.routes.platform_governance import router as platform_governance_router
from app.demo_runtime.routes import call_router as demo_call_router
from app.demo_runtime.routes import router as demo_runtime_router
from app.deps import require_studio_auth
from app.integrations.external.routes import router as external_connections_router
from app.integrations.routes import router as integrations_router
from app.llm.routes.local_models import router as local_models_router
from app.llm.routes.model_capacity import ModelCapacity
from app.llm.routes.model_inference import router as model_inference_router
from app.llm.routes.model_templates import router as model_templates_router
from app.llm.routes.models import (
    call_logs,
    catalog,
    model_test,
    model_test_generation,
    model_test_realtime,
    model_test_tools,
    model_test_transcription,
    suppliers,
)
from app.tool_navigation.codex_source_routes import router as codex_source_router
from app.tool_navigation.routes import router as tool_navigation_router
from app.tool_navigation.storage_usage_routes import router as storage_usage_router
from app.tool_navigation.video_download_routes import router as video_download_router

register_video_executor(apply_assistant_timeline_batch)

api_router = APIRouter(prefix="/v1")
api_router.include_router(local_models_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(interview_assistant_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(external_connections_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(article_sync_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(
    amadeus_router, dependencies=[Depends(require_desktop), Depends(require_amadeus_session)]
)
api_router.include_router(desktop_router)
api_router.include_router(desktop_agent_router)
api_router.include_router(accounts_router)
api_router.include_router(demo_runtime_router)
api_router.include_router(demo_call_router)
api_router.include_router(platform_governance_router)
api_router.include_router(model_templates_router)
api_router.include_router(management_router)
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
api_router.include_router(codex_source_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(storage_usage_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(
    video_download_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
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
    visual_outputs_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
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
    motion_compositor_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(
    thought_workshop_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(
    presentation_workshop_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    director_desk_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(
    model_inference_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
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

api_router.include_router(live2d_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(desktop_pet_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(creative_workshop_router, dependencies=[Depends(require_studio_auth)])

# Community endpoints authenticate browser sessions and apply publication roles.
api_router.include_router(community_router, prefix="/thought-workshop")
api_router.include_router(community_tables_router, prefix="/thought-workshop")

api_router.include_router(
    visual_acceptance_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(code_agents_router)

api_router.include_router(media_info.router, dependencies=[Depends(require_studio_auth)])
