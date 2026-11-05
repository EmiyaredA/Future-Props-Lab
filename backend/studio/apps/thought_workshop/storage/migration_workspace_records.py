"""Typed maintenance records for personal Thought workspace state."""

from datetime import datetime
from typing import Literal

from pydantic import Field

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
