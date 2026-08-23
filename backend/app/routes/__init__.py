from fastapi import APIRouter, Depends

from app.deps import require_studio_auth
from app.routes.accounts import router as accounts_router
from app.routes.audio_annotation import router as audio_annotation_router
from app.routes.file_management import router as file_management_router
from app.routes.galgame_workshop import router as galgame_workshop_router
from app.routes.integrations import router as integrations_router
from app.routes.models import (
    call_logs,
    catalog,
    model_test,
    model_test_generation,
    model_test_realtime,
    model_test_tools,
    model_test_transcription,
)
from app.routes.public_workspace import router as public_workspace_router
from app.routes.tool_navigation import router as tool_navigation_router
from app.routes.video_editor import router as video_editor_router
from app.routes.visual_assistant import router as visual_assistant_router
from app.routes.visual_generation import router as visual_generation_router
from app.routes.visual_workshop import router as visual_workshop_router
from app.routes.workspaces import invitation_router
from app.routes.workspaces import router as workspaces_router

api_router = APIRouter(prefix="/v1")
api_router.include_router(accounts_router)
api_router.include_router(workspaces_router)
api_router.include_router(invitation_router)
api_router.include_router(public_workspace_router)
api_router.include_router(catalog.router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(call_logs.router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(model_test.router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(model_test_tools.router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(model_test_generation.router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(model_test_realtime.router)
api_router.include_router(
    model_test_transcription.router, dependencies=[Depends(require_studio_auth)]
)
api_router.include_router(tool_navigation_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(integrations_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(audio_annotation_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(file_management_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(visual_workshop_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(visual_assistant_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(visual_generation_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(galgame_workshop_router, dependencies=[Depends(require_studio_auth)])
api_router.include_router(video_editor_router, dependencies=[Depends(require_studio_auth)])
