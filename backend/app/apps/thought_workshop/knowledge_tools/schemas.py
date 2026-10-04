from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.apps.thought_workshop.multitable.schemas import Snapshot
from app.apps.thought_workshop.multitable.validation import validate_snapshot
from app.apps.thought_workshop.schemas.document import validate_document
from app.apps.thought_workshop.schemas.workshop import ThoughtNoteSummary, ThoughtRevisionIn


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    @field_validator("name", check_fields=False)
    @classmethod
    def nonblank_name(cls, value):
        if not value.strip():
            raise ValueError("名称不能为空")
        return value.strip()


class SearchCriteria(StrictInput):
    query: str = Field(default="", max_length=500)
    knowledge_base_id: str | None = None
    tag: str = Field(default="", max_length=40)
    favorite: bool = False
    title_only: bool = False


class SearchHit(ThoughtNoteSummary):
    knowledge_base_title: str
    path: list[str]
    snippet: str


class SearchResult(BaseModel):
    items: list[SearchHit]
    total: int


class ResolveReferences(StrictInput):
    ids: list[str] = Field(max_length=100)


class ReferenceTarget(BaseModel):
    id: str
    available: bool
    title: str = ""
    knowledge_base_id: str | None = None
    excerpt: str = ""
    revision: int | None = None


class TemplateIn(StrictInput):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    document: dict
    kind: Literal["note", "multitable"] = Field(
        default="note", json_schema_extra=lambda s: s.pop("default", None)
    )
    multitable: Snapshot | None = None
    schema_version: Literal[2, 3] = 3
    tags: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def table_valid(self):
        if (self.kind == "multitable") != (self.multitable is not None):
            raise ValueError("多维表格模板必须包含完整表格快照")
        if self.multitable is not None:
            validate_snapshot(self.multitable)
        return self

    @field_validator("name")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("名称不能为空")
        return value.strip()

    @field_validator("document")
    @classmethod
    def document_valid(cls, value):
        return validate_document(value)

    @field_validator("tags")
    @classmethod
    def tags_valid(cls, value):
        if any(not isinstance(tag, str) or len(tag) > 40 for tag in value):
            raise ValueError("标签不能超过 40 字")
        return list(dict.fromkeys(tag.strip() for tag in value if tag.strip()))


class TemplatePut(TemplateIn, ThoughtRevisionIn):
    pass


class TemplateOut(TemplateIn):
    id: str
    revision: int
    created_at: datetime
    updated_at: datetime


class TemplateApply(ThoughtRevisionIn):
    knowledge_base_id: str
    parent_id: str | None = None
    title: str = Field(min_length=1, max_length=240)
    expected_knowledge_revision: int = Field(ge=0)


class DuplicateIn(StrictInput):
    knowledge_base_id: str
    parent_id: str | None = None
    subtree: bool = False
    source_knowledge_revision: int = Field(ge=0)
    expected_knowledge_revision: int = Field(ge=0)
    expected_revisions: dict[str, int] = Field(max_length=10000)


class DuplicateSnapshot(BaseModel):
    knowledge_revision: int
    revisions: dict[str, int]


class DuplicateOut(BaseModel):
    root_id: str
    note_ids: list[str]
    knowledge_base_id: str


class CheckpointIn(StrictInput):
    name: str = Field(min_length=1, max_length=120)
    history_id: str
    expected_note_revision: int = Field(ge=0)


class CheckpointPut(ThoughtRevisionIn):
    name: str = Field(min_length=1, max_length=120)


class CheckpointOut(StrictInput):
    id: str
    note_id: str
    history_id: str
    name: str
    revision: int
    created_at: datetime


class SavedFilterIn(StrictInput):
    name: str = Field(min_length=1, max_length=120)
    criteria: SearchCriteria


class SavedFilterPut(SavedFilterIn, ThoughtRevisionIn):
    pass


class SavedFilterOut(SavedFilterIn):
    id: str
    revision: int


class ReadingPosition(StrictInput):
    note_revision: int | None = Field(default=None, ge=0)
    paragraph: str = Field(default="", max_length=240)
    ratio: float = Field(default=0, ge=0, le=1)


class ReadingIn(StrictInput):
    resource_id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=240)
    position: ReadingPosition = Field(default_factory=ReadingPosition)


class ReadingOut(ReadingIn):
    visited_at: datetime


class LibraryExportSnapshot(BaseModel):
    knowledge_base: dict
    documents: list[dict]
    asset_ids: list[str]
