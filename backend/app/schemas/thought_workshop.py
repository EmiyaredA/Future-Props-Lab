from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.thought_document import empty_document, validate_document


class ThoughtNoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(default="未命名笔记", min_length=1, max_length=240)
    knowledge_base_id: str
    folder_id: str | None = None
    schema_version: Literal[2] = 2
    document: dict = Field(default_factory=empty_document)
    tags: list[str] = Field(default_factory=list, max_length=30)
    pinned: bool = False
    favorite: bool = False

    @field_validator("document")
    @classmethod
    def valid_document(cls, value: dict) -> dict:
        return validate_document(value)

    @field_validator("tags")
    @classmethod
    def valid_tags(cls, values: list[str]) -> list[str]:
        tags = list(dict.fromkeys(v.strip() for v in values if v.strip()))
        if any(len(v) > 40 for v in tags):
            raise ValueError("标签不能超过 40 字")
        return tags

    @field_validator("title")
    @classmethod
    def valid_title(cls, value: str) -> str:
        return value.strip() or "未命名笔记"


class ThoughtNoteCreate(ThoughtNoteIn):
    expected_knowledge_revision: int = Field(ge=0)


class ThoughtNotePut(ThoughtNoteIn):
    expected_revision: int = Field(ge=0)


class ThoughtRevisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)


class ThoughtNoteTransitionIn(ThoughtRevisionIn):
    expected_knowledge_revision: int = Field(ge=0)


class ThoughtNoteSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    knowledge_base_id: str
    folder_id: str | None
    position: int
    is_home: bool
    tags: list[str]
    pinned: bool
    favorite: bool
    deleted_at: datetime | None
    revision: int
    created_at: datetime
    updated_at: datetime
    excerpt: str


class ThoughtNoteOut(ThoughtNoteSummary):
    schema_version: Literal[2]
    document: dict


class ThoughtNoteList(BaseModel):
    items: list[ThoughtNoteSummary]
    total: int
    tags: list[str]


class ThoughtImageOut(BaseModel):
    asset_id: str


class ThoughtAttachmentOut(BaseModel):
    asset_id: str
    filename: str
    mime_type: str
    byte_size: int


class ThoughtImportOut(BaseModel):
    note_ids: list[str]
    knowledge_base_ids: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ThoughtAssistantIn(ThoughtRevisionIn):
    model_id: str
    action: Literal["summary", "polish", "continue", "tasks", "custom"]
    instruction: str = Field(default="", max_length=4000)
    selection: str = Field(default="", max_length=100000)


class ThoughtModelOut(BaseModel):
    id: str
    label: str


class ThoughtAssistantEvent(BaseModel):
    type: Literal["delta", "complete", "error"]
    text: str = ""
    message: str = ""
