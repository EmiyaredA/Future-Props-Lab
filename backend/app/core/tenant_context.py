from __future__ import annotations

from contextvars import ContextVar
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from app.models import (
    AudioAnnotationProject,
    GalgameAssetTranscriptionTask,
    GalgameVideoEditorHandoffTask,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
    IntegrationCheck,
    LlmCallLog,
    McpIntegration,
    ModelEntry,
    ModelProvider,
    ModelTestConversation,
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
    ModelTestTool,
    ModelTestToolCall,
    ModelTestTranscriptionTask,
    SkillIntegration,
    ToolApiIntegration,
    ToolNavigationItem,
    VideoEditorOperationBatch,
    VideoEditorProject,
    VideoEditorTask,
    VisualAsset,
    VisualAssetFolder,
    VisualAssistantConversation,
    VisualGenerationTask,
    VisualProjectAssetReference,
    VisualWorkshopProject,
)

TENANT_MODELS = (
    AudioAnnotationProject,
    ModelProvider,
    ModelEntry,
    LlmCallLog,
    ToolNavigationItem,
    VisualWorkshopProject,
    VisualGenerationTask,
    VisualAssistantConversation,
    GalgameWorkshopProject,
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

_CURRENT_WORKSPACE: ContextVar[str] = ContextVar(
    "future_props_current_workspace", default="default"
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


def bind_workspace(session: Any, workspace_id: str) -> None:
    session.info["workspace_id"] = workspace_id
    _CURRENT_WORKSPACE.set(workspace_id)


def current_workspace_id() -> str:
    return _CURRENT_WORKSPACE.get()
