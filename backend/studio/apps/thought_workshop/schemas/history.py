from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from studio.apps.thought_workshop.schemas.document import validate_document


class ThoughtHistorySnapshot(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    note_id: str
    revision: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=240)
    document: dict
    schema_version: Literal[2, 3] = 2
    tags: list[str] = Field(max_length=30)
    author_id: str | None = None
    author_name: str = Field(max_length=120)
    source: Literal["baseline", "create", "edit", "restore", "import"]
    created_at: datetime

    @field_validator("document")
    @classmethod
    def valid_document(cls, value: dict) -> dict:
        return validate_document(value)

    @field_validator("tags")
    @classmethod
    def valid_tags(cls, value: list[str]) -> list[str]:
        if any(len(tag) > 40 for tag in value):
            raise ValueError("标签不能超过 40 字")
        return value


class ThoughtHistorySummary(BaseModel):
    id: str
    revision: int
    author_id: str | None
    author_name: str
    source: str
    created_at: datetime
    summary: str


class ThoughtHistoryList(BaseModel):
    items: list[ThoughtHistorySummary]
    next_cursor: str | None


class ThoughtHistoryDetail(BaseModel):
    current: ThoughtHistorySnapshot
    previous: ThoughtHistorySnapshot | None
