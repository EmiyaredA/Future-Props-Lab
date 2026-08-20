from __future__ import annotations

from contextvars import ContextVar

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from app.models import (
    AudioAnnotationProject,
    GalgameAssetTranscriptionTask,
    GalgameWorkshopProject,
    LlmCallLog,
    ModelEntry,
    ModelProvider,
    ModelTestConversation,
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
    ModelTestTranscriptionTask,
    ToolNavigationItem,
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
    VisualAssetFolder,
    VisualAsset,
    VisualProjectAssetReference,
    ModelTestConversation,
    ModelTestGenerationTask,
    ModelTestGenerationAsset,
    ModelTestTranscriptionTask,
)

_CURRENT_WORKSPACE: ContextVar[str] = ContextVar(
    "future_props_current_workspace", default="default"
)


@event.listens_for(Session, "do_orm_execute")
def _scope_tenant_selects(execute_state) -> None:
    workspace_id = execute_state.session.info.get("workspace_id")
    if not workspace_id or execute_state.session.info.get("tenant_bypass"):
        return
    if not execute_state.is_select:
        return
    statement = execute_state.statement
    for model in TENANT_MODELS:
        statement = statement.options(
            with_loader_criteria(
                model,
                lambda cls: cls.workspace_id == workspace_id,
                include_aliases=True,
            )
        )
    execute_state.statement = statement


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


def bind_workspace(session, workspace_id: str) -> None:
    session.info["workspace_id"] = workspace_id
    _CURRENT_WORKSPACE.set(workspace_id)


def current_workspace_id() -> str:
    return _CURRENT_WORKSPACE.get()
