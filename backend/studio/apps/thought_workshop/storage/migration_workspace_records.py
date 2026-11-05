"""Typed maintenance records for personal Thought workspace state."""

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from studio.apps.thought_workshop.schemas.workshop import ThoughtImportOut, ThoughtNoteOut
from studio.contracts.management.project_history import HistoryRecord, Identifier


class Template(HistoryRecord):
    id: Identifier
    name: str
    description: str
    document: dict
    kind: Literal["note", "multitable"]
    multitable: dict | None
    tags: list[str]
    schema_version: int
    revision: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime


class Checkpoint(HistoryRecord):
    id: Identifier
    note_id: Identifier
    history_id: Identifier
    name: str
    revision: int = Field(ge=0)
    created_at: datetime


class SavedFilter(HistoryRecord):
    id: Identifier
    user_id: Identifier
    name: str
    criteria: dict
    revision: int = Field(ge=0)


class ReadingState(HistoryRecord):
    id: Identifier
    user_id: Identifier
    resource_id: str
    title: str
    position: dict
    visited_at: datetime


class Publication(HistoryRecord):
    id: Identifier
    knowledge_base_id: Identifier
    publisher_id: Identifier
    title: str
    description: str
    cover_asset_id: Identifier | None
    active: bool
    is_official: bool
    read_only: bool
    editable_platform_roles: list[Literal["admin", "user"]]
    revision: int = Field(ge=0)
    updated_at: datetime


class PublishedArticle(HistoryRecord):
    cursor: str
    publication_id: Identifier
    note_id: Identifier
    visibility: Literal["public", "members"]
    active: bool
    revision: int = Field(ge=0)


class ArticleMember(HistoryRecord):
    cursor: str
    publication_id: Identifier
    note_id: Identifier
    user_id: Identifier
    role: Literal["read", "edit", "manage"]


class CommunityFavorite(HistoryRecord):
    cursor: str
    resource_id: str = Field(pattern=r"^(community|official)/[^/]+$", max_length=200)


class CommunityUpload(HistoryRecord):
    cursor: str
    note_id: Identifier
    asset_id: Identifier
    user_id: Identifier


class OfficialSource(HistoryRecord):
    cursor: str
    note_id: Identifier
    library_key: str = Field(min_length=1, max_length=80)
    document_key: str = Field(max_length=80)


class OfficialImportReceipt(HistoryRecord):
    cursor: str
    user_id: Identifier
    request_id: Identifier
    package_version: str = Field(pattern=r"^[a-f0-9]{64}$")
    result: dict
    created_at: datetime

    @field_validator("result")
    @classmethod
    def valid_result(cls, result):
        ThoughtImportOut.model_validate(result)
        # Preserve the exact persisted receipt, including historical optional keys.
        return result


class NoteOperationReceipt(HistoryRecord):
    cursor: str
    resource_kind: Literal["thought"]
    resource_id: Identifier
    request_id: str = Field(min_length=1, max_length=64)
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    result: dict
    created_at: datetime

    @model_validator(mode="after")
    def match_result(self):
        if ThoughtNoteOut.model_validate(self.result).id != self.resource_id:
            raise ValueError("编辑回执与文档 ID 不一致")
        return self
