"""ORM assembly: mapper imports and account-scoped session rules."""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from app.apps.agent_workbench.execution.models import WorkbenchChat, WorkbenchProject, WorkbenchTurn
from app.apps.agent_workbench.models import (
    WorkbenchChange,
    WorkbenchOperation,
    WorkbenchSession,
    WorkbenchSource,
)
from app.apps.audio_annotation.models import (
    AudioAnnotationDocument,
    AudioAnnotationProject,
    AudioAnnotationWaveform,
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
from app.apps.interview_assistant.models import InterviewPreparation, InterviewRoom
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
from app.apps.presentation_workshop.templates.models import (
    PresentationExample,
    PresentationExampleAsset,
    PresentationTemplate,
    PresentationTemplateAsset,
)
from app.apps.thought_workshop.external_sync.models import (
    ArticleSyncAsset,  # noqa: F401 — register child metadata
    ArticleSyncBinding,
    ArticleSyncStep,  # noqa: F401 — register child metadata
    ArticleSyncTask,
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
from app.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRepairDraft,
    AcceptanceRun,
    AcceptanceStandard,
    AcceptanceStandardVersion,
    AcceptanceTemplate,
    NodeAcceptanceBinding,
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
from app.capabilities.asset_store.upgrade_records import AccountStorageUpgradeRoot
from app.console.amadeus.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusQuestion,
    AmadeusRun,
    AmadeusRunEvent,
)
from app.console.cloud_control.models import CloudFactor, CloudUnlock, DesktopPreference
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
)
from app.integrations.external.models import ExternalConnection
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
    ModelTestTranscriptionTask,
)
from app.llm.models.model_inference import ModelInferenceAsset, ModelInferenceTask
from app.runtime.orm_base import Base
from app.runtime.ownership import TenantScopeError, bind_owner, require_owner_id
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
AUTOMATION_ROOTS: dict[str, type] = {
    "annotation": AudioAnnotationProject,
    "director": DirectorDeskProject,
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

# Runtime quota task kinds owned by migrated apps and llm.
RUNTIME_QUOTA_TASK_MODELS: dict[str, type] = {
    "visual_acceptance": AcceptanceRun,
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
}

# Ensure reference mappers are registered on Base.metadata for capability queries.
_ = (
    AccountStorageUpgradeRoot,
    PresentationTemplateAsset,
    PresentationExampleAsset,
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
    AcceptanceAssetReference,
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
)

TENANT_MODELS = (
    CloudFactor,
    CloudUnlock,
    DesktopPreference,
    WorkbenchChat,
    WorkbenchProject,
    WorkbenchTurn,
    WorkbenchSource,
    WorkbenchSession,
    WorkbenchOperation,
    WorkbenchChange,
    NodeAcceptanceBinding,
    InterviewRoom,
    InterviewPreparation,
    AcceptanceTemplate,
    AcceptanceStandard,
    AcceptanceStandardVersion,
    AcceptanceRun,
    AcceptanceRepairDraft,
    ExternalConnection,
    ArticleSyncBinding,
    ArticleSyncTask,
    Publication,
    OfficialSource,
    OfficialImportReceipt,
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
    PresentationTemplate,
    PresentationExample,
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
    ToolApiIntegration,
    McpIntegration,
    SkillIntegration,
    IntegrationCheck,
    CreativeInstallation,
)


@event.listens_for(Session, "do_orm_execute")
def _scope_tenant_selects(execute_state) -> None:
    owner_user_id = execute_state.session.info.get("owner_user_id")
    if not owner_user_id or execute_state.session.info.get("tenant_bypass"):
        return
    statement = execute_state.statement
    if execute_state.is_select:
        for model in TENANT_MODELS:
            statement = statement.options(
                with_loader_criteria(
                    model,
                    lambda cls: cls.owner_user_id == owner_user_id,
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
    owner_column = mapper.local_table.c.get("owner_user_id")
    if owner_column is None:
        return
    execute_state.statement = statement.where(owner_column == owner_user_id)


@event.listens_for(Session, "before_flush")
def _assign_owner(session: Session, _flush_context, _instances) -> None:
    owner_user_id = session.info.get("owner_user_id")
    if not owner_user_id or session.info.get("tenant_bypass"):
        return
    for row in session.new:
        if isinstance(row, TENANT_MODELS) and getattr(row, "owner_user_id", None) is None:
            row.owner_user_id = owner_user_id
    for row in {*session.new, *session.dirty, *session.deleted}:
        if isinstance(row, TENANT_MODELS) and getattr(row, "owner_user_id", None) != owner_user_id:
            raise TenantScopeError(f"{type(row).__name__} does not belong to the bound account")


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
    "AUTOMATION_ROOTS",
    "LAYOUT_PROJECT_MODELS",
    "RUNTIME_QUOTA_TASK_MODELS",
    "TENANT_MODELS",
    "TenantScopeError",
    "bind_owner",
    "require_owner_id",
]
