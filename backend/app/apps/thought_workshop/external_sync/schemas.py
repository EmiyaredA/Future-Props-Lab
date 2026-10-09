from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.integrations.external.schemas import ExternalTargetInput


class ArticleBindingInput(ExternalTargetInput):
    connection_id: str
    expected_revision: int = Field(ge=0)


class ArticleBindingOut(BaseModel):
    id: str
    connection_id: str
    url: str
    title: str
    revision: int
    last_note_revision: int | None
    last_synced_at: str | None


class ArticleSyncTaskOut(BaseModel):
    id: str
    status: Literal[
        "preview", "queued", "running", "succeeded", "conflict", "needs_review", "failed"
    ]
    note_revision: int
    message: str
    created_at: str
    updated_at: str
    steps: list[dict] = Field(default_factory=list)


class ArticleSyncState(BaseModel):
    binding: ArticleBindingOut | None
    tasks: list[ArticleSyncTaskOut]


class ArticlePreviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    binding_revision: int = Field(ge=0)


class SnapshotRun(BaseModel):
    text: str = ""
    style: dict[str, bool] = Field(default_factory=dict)
    link: str = ""


class SnapshotBlock(BaseModel):
    kind: Literal["heading", "text", "quote", "bullet", "ordered", "todo", "code", "table", "image"]
    runs: list[SnapshotRun] = Field(default_factory=list)
    level: int | None = None
    checked: bool | None = None
    asset_id: str | None = None
    rows: list[list[list["SnapshotBlock"]]] | None = None


class ArticleSyncPreview(BaseModel):
    preview_id: str | None
    note_revision: int
    local_text: str
    snapshot: list[SnapshotBlock]
    remote_text: str
    target_title: str
    warnings: list[str]
    blockers: list[str]
    remote_changed: bool
    first_sync: bool


class ArticleSyncSubmit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preview_id: str
    operation_id: UUID
    confirm_replace: bool


class ArticleSyncReconcile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    acknowledge_partial: bool = False


class ArticleSyncReconcileOut(BaseModel):
    task: ArticleSyncTaskOut
    remote_text: str
    can_resume: bool
