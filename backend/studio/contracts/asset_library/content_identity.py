"""Account-scoped exact-content identity and recoverable duplicate cleanup."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class IdentityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asset_ids: list[str] = Field(min_length=1, max_length=200)


class ContentIdentity(BaseModel):
    asset_id: str
    content_key: str
    equivalent_ids: list[str]


class ContentIdentities(BaseModel):
    items: list[ContentIdentity]
    unavailable_ids: list[str] = Field(default_factory=list)


class ContentAuditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    project_ids: list[str] = Field(min_length=1, max_length=100)


class DuplicateMember(BaseModel):
    id: str
    project_id: str | None
    folder_id: str | None = None
    display_name: str
    original_filename: str
    media_kind: str
    mime_type: str
    byte_size: int
    revision: int
    created_at: str
    protected_by: list[str] = Field(default_factory=list)


class DuplicateGroup(BaseModel):
    content_key: str
    members: list[DuplicateMember]
    canonical_id: str
    state: Literal["audited", "reserved", "ready", "cleaned", "restored"] = "audited"
    removed_ids: list[str] = Field(default_factory=list)
    skipped: dict[str, str] = Field(default_factory=dict)
    reclaimed_bytes: int = 0


class ContentAudit(BaseModel):
    id: str
    revision: int
    project_ids: list[str]
    groups: list[DuplicateGroup]
    unavailable_ids: list[str] = Field(default_factory=list)


class DedupeStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    content_key: str = Field(pattern=r"^[a-f0-9]{64}$")
    remove_asset_ids: list[str] = Field(default_factory=list, max_length=1000)
