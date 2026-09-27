from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

CreativeKind = Literal["tool_api", "mcp", "skill", "bundle"]
CoverPreset = Literal["sunrise", "violet", "ocean", "mint"]


class CreativeDraftIn(BaseModel):
    kind: CreativeKind
    title: str = Field(default="", max_length=120)
    summary: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=10000)
    tags: list[str] = Field(default_factory=list, max_length=12)
    cover_preset: CoverPreset = "sunrise"
    manifest: dict[str, Any] = Field(default_factory=dict)
    components: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("title", "summary", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(tag.strip()[:40] for tag in value if tag.strip()))[:12]

    @field_validator("components")
    @classmethod
    def distinct_components(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("方案包不能重复选择同一能力版本")
        return value


class CreativeDraftUpdateIn(CreativeDraftIn):
    expected_revision: int = Field(ge=0)


class CreativeRevisionIn(BaseModel):
    expected_revision: int = Field(ge=0)


class CreativeImportIn(BaseModel):
    kind: Literal["tool_api", "mcp", "skill"]
    source_id: str


class CreativeItemOut(BaseModel):
    id: str
    kind: CreativeKind
    status: Literal["draft", "published", "withdrawn"]
    title: str
    summary: str
    description: str
    tags: list[str]
    cover_preset: str
    cover_url: str | None
    manifest: dict[str, Any]
    components: list[str]
    revision: int
    author_user_id: str
    author_name: str
    origin_workspace_id: str
    current_release_id: str | None
    version: int | None
    installable: bool
    created_at: str
    updated_at: str


class CreativePageOut(BaseModel):
    items: list[CreativeItemOut]
    next_cursor: str | None = None


class CreativeReleaseOut(BaseModel):
    id: str
    item_id: str
    kind: CreativeKind
    version: int
    title: str
    summary: str
    description: str
    tags: list[str]
    cover_preset: str
    cover_url: str | None
    manifest: dict[str, Any]
    components: list[str]
    author_name: str
    installable: bool
    created_at: str


class CreativeInstallPreviewIn(BaseModel):
    release_id: str
    names: dict[str, str] = Field(default_factory=dict)


class CreativeInstallPartOut(BaseModel):
    release_id: str
    kind: Literal["tool_api", "mcp", "skill"]
    title: str
    target_name: str
    conflict: bool
    already_installed: bool
    pending_setup: bool


class CreativeInstallPreviewOut(BaseModel):
    release_id: str
    parts: list[CreativeInstallPartOut]
    installable: bool


class CreativeInstallOut(BaseModel):
    id: str
    release_id: str
    resources: list[dict[str, Any]]
    already_installed: bool = False


class CreativeStdioSetupIn(BaseModel):
    release_id: str
    command: str = Field(min_length=1, max_length=1024)
    arguments: list[str] = Field(default_factory=list, max_length=64)
    environment: dict[str, str] = Field(default_factory=dict)
