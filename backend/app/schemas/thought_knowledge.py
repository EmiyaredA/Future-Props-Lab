"""Document project and directory contracts; revisions belong to the project."""

from datetime import datetime

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


class ThoughtDirectoryOut(BaseModel):
    knowledge_base: KnowledgeBaseOut
    documents: list[ThoughtNoteSummary]


class ThoughtMoveIn(ThoughtRevisionIn):
    item_id: str
    parent_id: str | None = None
    before_id: str | None = None


class KnowledgeNoteCreate(ThoughtRevisionIn):
    title: str = Field(default="未命名文档", min_length=1, max_length=240)
    parent_id: str | None = None
