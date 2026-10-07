"""ORM assembly: mapper imports and workspace-scoped session rules."""

from __future__ import annotations

from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from app.apps.audio_annotation.models import (
    AudioAnnotationDocument,
    AudioAnnotationProject,
    AudioAnnotationWaveform,
)
from app.apps.desktop_pet.models import (
    DesktopPetChat,
    DesktopPetProject,
)
from app.apps.director_desk.models import DirectorDeskProject, DirectorDeskUserMotion
from app.apps.galgame_workshop.models import (
    GalgameAnnotationImportTask,
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameAssetTranscriptionTask,
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameStorySnapshot,
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
)
from app.apps.live2d_workshop.models import (
    Live2DAsset,
    Live2DCubismAttachment,
    Live2DExport,
    Live2DProject,
)
from app.apps.motion_compositor.models import (
    MotionDocument,
    MotionOperationBatch,
    MotionProject,
    MotionTask,
)
from app.apps.presentation_workshop.models import (
    PresentationAssetReference,
    PresentationProject,
)
from app.apps.thought_workshop.knowledge_tools.models import (
    ThoughtCheckpoint,
    ThoughtDocumentReference,
    ThoughtReadingState,
    ThoughtSavedFilter,
    ThoughtTemplate,
    ThoughtTemplateAsset,
)
from app.apps.thought_workshop.models import (
    ThoughtHistoryAsset,
    ThoughtKnowledgeBase,
    ThoughtNote,
    ThoughtNoteAsset,
    ThoughtNoteHistory,
)
from app.apps.thought_workshop.multitable.models import (
    DataAsset,
    DataChange,
    DataField,
    DataRecord,
    DataTable,
    DataView,
)
from app.apps.thought_workshop.publication.models import (
    ArticleMember,
    CommunityFavorite,
    CommunityUpload,
    OfficialImportReceipt,
    OfficialSource,
    Publication,
    PublishedArticle,
)
from app.apps.video_editor.models import (
    VideoEditorAssetMetadata,
    VideoEditorOperationBatch,
    VideoEditorProject,
    VideoEditorTask,
    VideoEditorTimeline,
)
from app.apps.visual_workshop.models import (
    VisualAssistantAction,
    VisualAssistantConversation,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
    VisualCanvasDocument,
    VisualGenerationBatch,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualAssetFolder,
    VisualProjectAssetReference,
)
from app.console.amadeus.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusQuestion,
    AmadeusRun,
    AmadeusRunEvent,
)
from app.console.creative_workshop.models import (
    CreativeInstallation,
)
from app.console.models import (
    AuthSession,
    ManagementApiKey,
    ModelTemplateSyncItem,
    ModelTemplateSyncJob,
    PlatformSetting,
    RegistrationInviteCode,
    RegistrationRedemption,
    RuntimeAdmission,
    SecurityAuditEvent,
    User,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
)
from app.integrations.models import (
    IntegrationCheck,
    McpDiscoveredTool,
    McpIntegration,
    SkillIntegration,
    SkillVersion,
    ToolApiIntegration,
)
from app.llm.models import (
    LlmCallLog,
    ModelCatalogState,
    ModelEntry,
    ModelProvider,
    ModelSupplier,
    ModelTestConversation,
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
    ModelTestTool,
    ModelTestToolCall,
    ModelTestTranscriptionTask,
)
from app.llm.models.model_inference import ModelInferenceAsset, ModelInferenceTask
from app.runtime.orm_base import Base
from app.runtime.project_operations import ProjectOperationReceipt
from app.tool_navigation.models import (
    ToolNavigationItem,
)

# Catalog types for capabilities that must not import app.llm.
CATALOG_MODELS: dict[str, type] = {
    "entry": ModelEntry,
    "provider": ModelProvider,
}

# App-owned roots registered at assembly time so console must not import apps/.
DESKTOP_UI_ROOTS: dict[str, type] = {
    "annotation": AudioAnnotationProject,
    "director": DirectorDeskProject,
    "pet": DesktopPetProject,
    "galgame": GalgameWorkshopProject,
    "knowledge": ThoughtKnowledgeBase,
    "mcp": McpIntegration,
    "note": ThoughtNote,
    "presentation": PresentationProject,
    "skill": SkillIntegration,
    "tool-api": ToolApiIntegration,
    "video": VideoEditorProject,
    "motion": MotionProject,
    "visual": VisualWorkshopProject,
}

CERTIFIABLE_PROJECT_ROOTS: dict[str, type] = {
    "galgame": GalgameWorkshopProject,
    "visual": VisualWorkshopProject,
}

# Public workspace projection for migrated apps.
PUBLIC_WORKSPACE_PROJECT_MODELS: dict[str, type] = {
    "galgame": GalgameWorkshopProject,
    "visual": VisualWorkshopProject,
}

PUBLIC_WORKSPACE_GALGAME_MODELS: dict[str, type] = {
    "asset_reference": GalgameProjectAssetReference,
    "story": GalgameStoryDocument,
}

# Runtime quota task kinds owned by migrated apps and llm.
RUNTIME_QUOTA_TASK_MODELS: dict[str, type] = {
    "galgame_asr": GalgameAssetTranscriptionTask,
    "inference": ModelInferenceTask,
    "model": ModelTestGenerationTask,
    "transcription": ModelTestTranscriptionTask,
    "visual": VisualGenerationTask,
}

# Storage layout migration project roots for migrated apps.
LAYOUT_PROJECT_MODELS: dict[str, type] = {
    "galgame-workshop": GalgameWorkshopProject,
    "visual-workshop": VisualWorkshopProject,
    "video-editor": VideoEditorProject,
    "motion-compositor": MotionProject,
    "live2d-workshop": Live2DProject,
    "desktop-pet": DesktopPetProject,
}

# Ensure reference mappers are registered on Base.metadata for capability queries.
_ = (
    PresentationAssetReference,
    AudioAnnotationDocument,
    AudioAnnotationWaveform,
    ThoughtHistoryAsset,
    ThoughtNoteAsset,
    ThoughtNoteHistory,
    VideoEditorAssetMetadata,
    VideoEditorTimeline,
    MotionDocument,
    VisualAssistantAction,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
    VisualCanvasDocument,
    VisualNodeOutput,
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameStorySnapshot,
    McpDiscoveredTool,
    SkillVersion,
    AuthSession,
    ManagementApiKey,
    ModelTemplateSyncItem,
    ModelTemplateSyncJob,
    PlatformSetting,
    RegistrationInviteCode,
    RegistrationRedemption,
    RuntimeAdmission,
    SecurityAuditEvent,
    User,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
)

TENANT_MODELS = (
    Publication,
    OfficialSource,
    OfficialImportReceipt,
    DesktopPetChat,
    DesktopPetProject,
    Live2DProject,
    Live2DAsset,
    Live2DCubismAttachment,
    Live2DExport,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusAction,
    AmadeusRun,
    AmadeusRunEvent,
    AmadeusQuestion,
    ModelInferenceAsset,
    ModelInferenceTask,
    ProjectOperationReceipt,
    PresentationProject,
    DirectorDeskProject,
    DirectorDeskUserMotion,
    AudioAnnotationProject,
    ModelCatalogState,
    ModelProvider,
    ModelSupplier,
    ModelEntry,
    LlmCallLog,
    ToolNavigationItem,
    ThoughtNote,
    ThoughtTemplate,
    ThoughtSavedFilter,
    ThoughtReadingState,
    ThoughtKnowledgeBase,
    VisualWorkshopProject,
    VisualGenerationTask,
    VisualGenerationBatch,
    VisualAssistantConversation,
    GalgameWorkshopProject,
    GalgameAnnotationImportTask,
    GalgameAssetTranscriptionTask,
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
    VisualAssetFolder,
    VisualAsset,
    VisualProjectAssetReference,
    VideoEditorProject,
    VideoEditorOperationBatch,
    VideoEditorTask,
    MotionProject,
    MotionOperationBatch,
    MotionTask,
    ModelTestConversation,
    ModelTestGenerationTask,
    ModelTestGenerationAsset,
    ModelTestTranscriptionTask,
    ModelTestTool,
    ModelTestToolCall,
    ToolApiIntegration,
    McpIntegration,
    SkillIntegration,
    IntegrationCheck,
    CreativeInstallation,
)


@event.listens_for(Session, "do_orm_execute")
def _scope_tenant_selects(execute_state) -> None:
    workspace_id = execute_state.session.info.get("workspace_id")
    if not workspace_id or execute_state.session.info.get("tenant_bypass"):
        return
    statement = execute_state.statement
    if execute_state.is_select:
        for model in TENANT_MODELS:
            statement = statement.options(
                with_loader_criteria(
                    model,
                    lambda cls: cls.workspace_id == workspace_id,
                    include_aliases=True,
                )
            )
        execute_state.statement = statement
        return

    if not (execute_state.is_update or execute_state.is_delete):
        return
    mapper = execute_state.bind_mapper
    if mapper is None or mapper.class_ not in TENANT_MODELS:
        return
    workspace_column = mapper.local_table.c.get("workspace_id")
    if workspace_column is None:
        return
    execute_state.statement = statement.where(workspace_column == workspace_id)


@event.listens_for(Session, "before_flush")
def _assign_workspace(session: Session, _flush_context, _instances) -> None:
    workspace_id = session.info.get("workspace_id")
    if not workspace_id or session.info.get("tenant_bypass"):
        return
    for row in session.new:
        if isinstance(row, TENANT_MODELS) and getattr(row, "workspace_id", None) in {
            None,
            "default",
        }:
            row.workspace_id = workspace_id
    for row in {*session.dirty, *session.deleted}:
        if isinstance(row, TENANT_MODELS) and getattr(row, "workspace_id", None) != workspace_id:
            raise TenantScopeError(f"{type(row).__name__} does not belong to the bound workspace")


class TenantScopeError(RuntimeError):
    """Raised when an ORM write crosses the workspace bound to its session."""


def require_workspace_id(value: object, *, subject: str = "resource") -> str:
    workspace_id = str(value or "").strip()
    if not workspace_id:
        raise TenantScopeError(f"{subject} is missing workspace ownership")
    return workspace_id


def bind_workspace(session: Any, workspace_id: str) -> None:
    session.info["workspace_id"] = require_workspace_id(workspace_id, subject="database session")


__all__ = [
    "DataTable",
    "DataField",
    "DataView",
    "DataRecord",
    "DataChange",
    "DataAsset",
    "Publication",
    "PublishedArticle",
    "ArticleMember",
    "CommunityFavorite",
    "CommunityUpload",
    "ThoughtDocumentReference",
    "ThoughtTemplateAsset",
    "ThoughtCheckpoint",
    "Base",
    "CATALOG_MODELS",
    "CERTIFIABLE_PROJECT_ROOTS",
    "DESKTOP_UI_ROOTS",
    "LAYOUT_PROJECT_MODELS",
    "PUBLIC_WORKSPACE_GALGAME_MODELS",
    "PUBLIC_WORKSPACE_PROJECT_MODELS",
    "RUNTIME_QUOTA_TASK_MODELS",
    "TENANT_MODELS",
    "TenantScopeError",
    "bind_workspace",
    "require_workspace_id",
]
