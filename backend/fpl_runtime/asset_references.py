"""Versioned retention messages shared by Assets and its authorized consumers."""

from types import MappingProxyType

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

VIDEO_FILE_CHANGES = frozenset({"file-name", "file-removal"})

RESOURCE_KINDS = MappingProxyType(
    {
        "visual": frozenset(
            {"project", "canvas", "conversation", "acceptance", "output", "history"}
        ),
        "thought": frozenset(
            {"note", "history", "template", "publication", "knowledge-base", "sync"}
        ),
        "galgame": frozenset({"project", "story", "history", "export"}),
        "video": frozenset({"project", "history", "export"}) | VIDEO_FILE_CHANGES,
        "motion": frozenset({"project", "history", "export"}),
        "presentation": frozenset({"project", "history", "template", "example", "export"}),
        "annotation": frozenset({"project", "history", "export"}),
        "director": frozenset({"project", "history", "export"}),
        "interview": frozenset({"project", "preparation"}),
        "creative": frozenset({"publication", "installation", "delivery"}),
        "models": frozenset({"inference", "test", "transcription"}),
        "rendering": frozenset({"job"}),
        "agent-runtime": frozenset({"run"}),
        "integrations": frozenset({"skill", "tool-api", "mcp"}),
        "amadeus": frozenset({"conversation", "run"}),
        "tools": frozenset({"download", "job"}),
    }
)


class ReferenceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    resource_kind: str = Field(pattern=r"^[a-z][a-z-]{0,63}$")
    resource_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    resource_revision: int = Field(ge=0, strict=True)
    expected_revision: int = Field(ge=0, strict=True)
    asset_ids: list[str] = Field(max_length=10000)

    @field_validator("asset_ids")
    @classmethod
    def canonical_assets(cls, values):
        import re

        if len(set(values)) != len(values) or any(
            not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value) for value in values
        ):
            raise ValueError("素材 ID 无效或重复")
        return sorted(values)

    def validate_service(self, service):
        if self.resource_kind not in RESOURCE_KINDS.get(service, ()):
            raise ValueError("调用方不能管理此类素材引用")


class VideoFileRename(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    project_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    display_name: str = Field(min_length=1, max_length=255)


class VideoFileRemoval(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    project_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    render_id: str | None = Field(
        default=None,
        pattern=r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
    )


class PrepareReferenceChange(BaseModel):
    """A source mutation retains prospective files until its local outcome is known."""

    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    resource_kind: str = Field(pattern=r"^[a-z][a-z-]{0,63}$")
    resource_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    expected_resource_revision: int = Field(ge=-1, strict=True)
    asset_ids: list[str] = Field(max_length=10000)
    metadata_asset_ids: list[str] | None = Field(default=None, max_length=10000)

    carried_asset_ids: list[str] | None = Field(default=None, max_length=10000)
    video_file_rename: VideoFileRename | None = None
    video_file_removal: VideoFileRemoval | None = None

    @model_validator(mode="after")
    def check_video_file_change(self):
        valid = {
            "file-name": self.video_file_rename is not None and self.video_file_removal is None,
            "file-removal": self.video_file_removal is not None and self.video_file_rename is None,
        }
        if self.resource_kind in valid:
            if (
                not valid[self.resource_kind]
                or self.expected_resource_revision < 0
                or self.asset_ids
                or self.metadata_asset_ids is not None
                or self.carried_asset_ids is not None
            ):
                raise ValueError("剪辑素材变更范围无效")
        elif self.video_file_rename is not None or self.video_file_removal is not None:
            raise ValueError("素材范围仅适用于剪辑原件变更")
        return self

    @field_validator("asset_ids", "metadata_asset_ids", "carried_asset_ids")
    @classmethod
    def canonical_assets(cls, values):
        return ReferenceUpdate.canonical_assets(values) if values is not None else None

    def validate_service(self, service):
        if self.resource_kind not in RESOURCE_KINDS.get(service, ()):
            raise ValueError("调用方不能管理此类素材引用")
