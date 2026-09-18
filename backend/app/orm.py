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
from app.apps.presentation_workshop.models import (
    PresentationAssetReference,
    PresentationProject,
)
from app.apps.thought_workshop.models import (
    ThoughtHistoryAsset,
    ThoughtKnowledgeBase,
    ThoughtNote,
    ThoughtNoteAsset,
    ThoughtNoteHistory,
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
from app.models import (  # noqa: F401
    GalgameAnnotationImportTask,
    GalgameAssetTranscriptionTask,
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
    IntegrationCheck,
    LlmCallLog,
    McpIntegration,
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
    SkillIntegration,
    ToolApiIntegration,
    ToolNavigationItem,
)
from app.models.files import VisualAsset, VisualAssetFolder, VisualProjectAssetReference
from app.models.model_inference import ModelInferenceAsset, ModelInferenceTask
from app.models.project_operations import ProjectOperationReceipt
from app.runtime.orm_base import Base

# App-owned roots registered at assembly time so console must not import apps/.
DESKTOP_UI_ROOTS: dict[str, type] = {
    "annotation": AudioAnnotationProject,
    "knowledge": ThoughtKnowledgeBase,
    "note": ThoughtNote,
    "presentation": PresentationProject,
    "video": VideoEditorProject,
    "visual": VisualWorkshopProject,
}

# Console project certification (galgame remains on app.models until its app slice).
CERTIFIABLE_PROJECT_ROOTS: dict[str, type] = {
    "visual": VisualWorkshopProject,
}

# Public workspace projection for migrated apps.
PUBLIC_WORKSPACE_PROJECT_MODELS: dict[str, type] = {
    "visual": VisualWorkshopProject,
}

# Runtime quota task kinds owned by migrated apps.
RUNTIME_QUOTA_TASK_MODELS: dict[str, type] = {
    "visual": VisualGenerationTask,
}

# Storage layout migration project roots for migrated apps.
LAYOUT_PROJECT_MODELS: dict[str, type] = {
    "visual-workshop": VisualWorkshopProject,
    "video-editor": VideoEditorProject,
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
    VisualAssistantAction,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
    VisualCanvasDocument,
)

TENANT_MODELS = (
    ModelInferenceAsset,
    ModelInferenceTask,
    ProjectOperationReceipt,
    PresentationProject,
    AudioAnnotationProject,
    ModelCatalogState,
    ModelProvider,
    ModelSupplier,
    ModelEntry,
    LlmCallLog,
    ToolNavigationItem,
    ThoughtNote,
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
    "Base",
    "CERTIFIABLE_PROJECT_ROOTS",
    "DESKTOP_UI_ROOTS",
    "LAYOUT_PROJECT_MODELS",
    "PUBLIC_WORKSPACE_PROJECT_MODELS",
    "RUNTIME_QUOTA_TASK_MODELS",
    "TENANT_MODELS",
    "TenantScopeError",
    "bind_workspace",
    "require_workspace_id",
]
