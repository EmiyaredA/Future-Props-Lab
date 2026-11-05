from fastapi import APIRouter, Depends

from app.console.routes.amadeus import require_amadeus_session
from app.console.routes.amadeus import router as amadeus_router
from app.console.routes.cloud_control import router as cloud_control_router
from app.console.routes.code_agents import router as code_agents_router
from app.console.routes.creative_workshop import router as creative_workshop_router
from app.tool_navigation.routes import router as tool_navigation_router
from app.tool_navigation.video_download_routes import router as video_download_router
from studio.apps.agent_workbench.transport.website import router as agent_workbench_router
from studio.apps.asset_library.transport.website.files import router as file_management_router
from studio.apps.audio_annotation.routes import router as audio_annotation_router
from studio.apps.director_desk.transport.website import router as director_desk_router
from studio.apps.galgame_workshop.transport.website import router as galgame_workshop_router
from studio.apps.gateway.transport.website.automation import router as automation_router
from studio.apps.identity.transport.website.account_management import router as management_router
from studio.apps.identity.transport.website.accounts import router as accounts_router
from studio.apps.identity.transport.website.project_markers import router as project_markers_router
from studio.apps.identity.transport.website.registration import router as registration_router
from studio.apps.integrations.transport.catalog_http import router as integrations_router
from studio.apps.integrations.transport.connections_http import (
    router as external_connections_router,
)
from studio.apps.interview_assistant.transport.website import router as interview_assistant_router
from studio.apps.media_rendering.transport.website import (
    image_crop,
    media_info,
    previews,
    video_frames,
)
from studio.apps.model_service.transport.website.demo import call_router as demo_call_router
from studio.apps.model_service.transport.website.demo import router as demo_runtime_router
from studio.apps.model_service.transport.website.local_models import router as local_models_router
from studio.apps.model_service.transport.website.model_capacity import ModelCapacity
from studio.apps.model_service.transport.website.model_inference import (
    router as model_inference_router,
)
from studio.apps.model_service.transport.website.model_templates import (
    router as model_templates_router,
)
from studio.apps.model_service.transport.website.models import (
    call_logs,
    catalog,
    diagnostics,
    model_test,
    model_test_generation,
    model_test_realtime,
    model_test_transcription,
    suppliers,
)
from studio.apps.model_service.transport.website.quotas import router as quotas_router
from studio.apps.motion_compositor.transport.website.compatibility import (
    router as motion_compositor_router,
)
from studio.apps.portal.transport.website import router as developer_docs_router
from studio.apps.presentation_workshop.transport.website.compatibility import (
    router as presentation_workshop_router,
)
from studio.apps.thought_workshop import content_exports_http as thought_conversion
from studio.apps.thought_workshop.external_sync.records_http import router as sync_records_router
from studio.apps.thought_workshop.transport.website import router as thought_workshop_router
from studio.apps.thought_workshop.transport.website.community import router as community_router
from studio.apps.thought_workshop.transport.website.community_tables import (
    router as community_tables_router,
)
from studio.apps.thought_workshop.transport.website.external_sync import (
    router as article_sync_router,
)
from studio.apps.video_editor.transport.website.compatibility import router as video_editor_router
from studio.apps.visual_workshop.acceptance.review_routes import router as visual_review_router
from studio.apps.visual_workshop.acceptance.routes import router as visual_acceptance_router
from studio.apps.visual_workshop.acceptance.standard_routes import router as visual_standard_router
from studio.apps.visual_workshop.generation_routes import router as visual_generation_records_router
from studio.apps.visual_workshop.transport.website import router as visual_workshop_router
from studio.apps.visual_workshop.transport.website.assistant import (
    router as visual_assistant_router,
)
from studio.apps.visual_workshop.transport.website.generation import (
    router as visual_generation_router,
)
from studio.apps.visual_workshop.transport.website.outputs import router as visual_outputs_router
from studio.assembly.http_dependencies import require_studio_auth

api_router = APIRouter(prefix="/v1")
api_router.include_router(cloud_control_router)
api_router.include_router(agent_workbench_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(local_models_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(interview_assistant_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(external_connections_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(article_sync_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(sync_records_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(amadeus_router, dependencies=[Depends(require_amadeus_session)])
api_router.include_router(automation_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(accounts_router)
api_router.include_router(demo_runtime_router)
api_router.include_router(demo_call_router)
api_router.include_router(quotas_router)
api_router.include_router(developer_docs_router)
api_router.include_router(project_markers_router)
api_router.include_router(registration_router)
api_router.include_router(model_templates_router)
api_router.include_router(management_router)
api_router.include_router(
    catalog.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    diagnostics.router, dependencies=[Depends(require_studio_auth), ModelCapacity]
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
    visual_generation_records_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
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

api_router.include_router(creative_workshop_router, dependencies=[Depends(require_studio_auth)])

# Community endpoints authenticate browser sessions and apply publication roles.
api_router.include_router(community_router, prefix="/thought-workshop")
api_router.include_router(community_tables_router, prefix="/thought-workshop")

api_router.include_router(
    visual_acceptance_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    visual_standard_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)
api_router.include_router(
    visual_review_router, dependencies=[Depends(require_studio_auth), ModelCapacity]
)

api_router.include_router(code_agents_router)

api_router.include_router(media_info.router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(previews.router, dependencies=[Depends(require_studio_auth)])
