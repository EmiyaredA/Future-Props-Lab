"""ORM assembly: mapper imports and account-scoped session rules."""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from app.console.amadeus.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusQuestion,
    AmadeusRun,
    AmadeusRunEvent,
)
from app.console.cloud_control.models import CloudFactor, CloudUnlock
from app.console.cloud_control.preference_models import DesktopPreference
from app.console.models.platform_governance import PlatformSetting
from studio.apps.agent_workbench.execution.models import (
    WorkbenchChat,
    WorkbenchProject,
    WorkbenchTurn,
)
from studio.apps.agent_workbench.storage.models import (
    WorkbenchChange,
    WorkbenchOperation,
    WorkbenchSession,
    WorkbenchSource,
)
from studio.apps.asset_library.storage.layout.upgrade_records import AccountStorageUpgradeRoot
from studio.apps.asset_library.storage.models import VisualAsset, VisualAssetFolder
from studio.apps.audio_annotation.models import (
    AudioAnnotationDocument,
    AudioAnnotationProject,
    AudioAnnotationWaveform,
)
from studio.apps.creative_workshop.storage.models import CreativeInstallation
from studio.apps.director_desk.storage.models import DirectorDeskProject, DirectorDeskUserMotion
from studio.apps.galgame_workshop.storage.models import (
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
from studio.apps.identity.storage.models.accounts import (
    AuthSession,
    ManagementApiKey,
    SecurityAuditEvent,
    User,
)
from studio.apps.identity.storage.models.registration import (
    RegistrationInviteCode,
    RegistrationRedemption,
)
from studio.apps.integrations.storage.external_models import ExternalConnection
from studio.apps.integrations.storage.models import (
    IntegrationCheck,
    McpDiscoveredTool,
    McpIntegration,
    SkillIntegration,
    SkillVersion,
    ToolApiIntegration,
)
from studio.apps.interview_assistant.storage.models import InterviewPreparation, InterviewRoom
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_inference import (
    ModelInferenceAsset,
    ModelInferenceTask,
)
from studio.apps.model_service.storage.models.model_service import (
    ModelCatalogState,
    ModelEntry,
    ModelProvider,
)
from studio.apps.model_service.storage.models.model_supplier import ModelSupplier
from studio.apps.model_service.storage.models.model_templates import (
    ModelTemplateSyncItem,
    ModelTemplateSyncJob,
)
from studio.apps.model_service.storage.models.model_test import (
    ModelTestConversation,
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
    ModelTestTranscriptionTask,
)
from studio.apps.model_service.storage.models.runtime_admission import RuntimeAdmission
from studio.apps.motion_compositor.storage.models import (
    MotionDocument,
    MotionOperationBatch,
    MotionProject,
    MotionTask,
)
from studio.apps.presentation_workshop.storage.models import (
    PresentationAssetReference,
    PresentationProject,
)
from studio.apps.presentation_workshop.templates.models import (
    PresentationExample,
    PresentationExampleAsset,
    PresentationTemplate,
    PresentationTemplateAsset,
)
from studio.apps.thought_workshop.external_sync.models import ArticleSyncAsset as ArticleSyncAsset
from studio.apps.thought_workshop.external_sync.models import ArticleSyncBinding, ArticleSyncTask
from studio.apps.thought_workshop.external_sync.models import ArticleSyncStep as ArticleSyncStep
from studio.apps.thought_workshop.knowledge_tools.models import (
    ThoughtCheckpoint,
    ThoughtDocumentReference,
    ThoughtReadingState,
    ThoughtSavedFilter,
    ThoughtTemplate,
    ThoughtTemplateAsset,
)
from studio.apps.thought_workshop.multitable.models import (
    DataAsset,
    DataChange,
    DataField,
    DataRecord,
    DataTable,
    DataView,
)
from studio.apps.thought_workshop.publication.models import (
    ArticleMember,
    CommunityFavorite,
    CommunityUpload,
    OfficialImportReceipt,
    OfficialSource,
    Publication,
    PublishedArticle,
)
from studio.apps.thought_workshop.storage.models import (
    ThoughtHistoryAsset,
    ThoughtKnowledgeBase,
    ThoughtNote,
    ThoughtNoteAsset,
    ThoughtNoteHistory,
)
from studio.apps.tools.storage.navigation_models import ToolNavigationItem
from studio.apps.video_editor.storage.models import (
    VideoEditorAssetMetadata,
    VideoEditorOperationBatch,
    VideoEditorProject,
    VideoEditorTask,
    VideoEditorTimeline,
)
from studio.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRepairDraft,
    AcceptanceRun,
    AcceptanceStandard,
    AcceptanceStandardVersion,
    AcceptanceTemplate,
    NodeAcceptanceBinding,
)
from studio.apps.visual_workshop.asset_references.models import VisualProjectAssetReference
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.storage.models import (
    VisualAssistantAction,
    VisualAssistantConversation,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
    VisualCanvasDocument,
    VisualGenerationBatch,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from studio.runtime.database.orm_base import Base
from studio.runtime.database.ownership import TenantScopeError, bind_owner, require_owner_id
from studio.runtime.database.project_operations import ProjectOperationReceipt

# Catalog types for capabilities that must not import studio.apps.model_service.
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


class WebsiteSession(Session):
    """Website ownership rules never attach to another service session class."""


@event.listens_for(WebsiteSession, "do_orm_execute")
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


@event.listens_for(WebsiteSession, "before_flush")
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
