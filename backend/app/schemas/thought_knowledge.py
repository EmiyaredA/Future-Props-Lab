"""Document project and directory contracts; revisions belong to the project."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.thought_workshop import ThoughtNoteSummary, ThoughtRevisionIn


class KnowledgeBaseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    cover_asset_id: str | None = None

    @field_validator("title")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("名称不能为空")
        return value.strip()


class KnowledgeBasePut(KnowledgeBaseIn, ThoughtRevisionIn):
    pass


class KnowledgeBaseOut(KnowledgeBaseIn):
    model_config = ConfigDict(from_attributes=True)
    id: str
    home_note_id: str
    revision: int
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    document_count: int = 0


class ThoughtFolderIn(ThoughtRevisionIn):
    title: str = Field(min_length=1, max_length=120)
    parent_id: str | None = None

    _title = field_validator("title")(KnowledgeBaseIn.nonblank.__func__)


class ThoughtFolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    knowledge_base_id: str
    parent_id: str | None
    title: str
    position: int
    created_at: datetime
    updated_at: datetime


class ThoughtDirectoryOut(BaseModel):
    knowledge_base: KnowledgeBaseOut
    folders: list[ThoughtFolderOut]
    documents: list[ThoughtNoteSummary]


class ThoughtMoveIn(ThoughtRevisionIn):
    kind: Literal["folder", "document"]
    item_id: str
    parent_id: str | None = None
    before_id: str | None = None


class KnowledgeNoteCreate(ThoughtRevisionIn):
    title: str = Field(default="未命名文档", min_length=1, max_length=240)
    folder_id: str | None = None
