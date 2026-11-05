"""Versioned retention messages shared by Assets and its authorized consumers."""

from types import MappingProxyType
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from studio.contracts.visual_workshop.visual_samples import VisualEvidenceUpload
from studio.contracts.visual_workshop.visual_upload import VisualUpload

PROJECT_FILE_CHANGES = frozenset({"file-name", "file-removal"})
VIDEO_FILE_CHANGES = PROJECT_FILE_CHANGES

RESOURCE_KINDS = MappingProxyType(
    {
        "visual": frozenset(
            {"project", "canvas", "conversation", "acceptance", "output", "history"}
        ),
        "thought": frozenset(
            {"note", "history", "template", "publication", "knowledge-base", "sync"}
        ),
        "galgame": frozenset({"project", "story", "history", "export"}) | PROJECT_FILE_CHANGES,
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


class GalgameFileMutation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    project_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    display_name: str | None = Field(default=None, min_length=1, max_length=255)


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
    galgame_file_mutation: GalgameFileMutation | None = None
    galgame_project_removal: Literal[True] | None = None
    visual_upload: VisualUpload | None = None
    visual_evidence: VisualEvidenceUpload | None = None
    visual_review_project: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,128}$")
    visual_project_removal: list[str] | None = Field(default=None, max_length=10000)
    visual_conversation_project: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,128}$")

    @model_validator(mode="after")
    def check_project_file_change(self):
        valid = {
            "file-name": self.video_file_rename is not None and self.video_file_removal is None,
            "file-removal": self.video_file_removal is not None and self.video_file_rename is None,
        }
        galgame = self.galgame_file_mutation
        if galgame is not None:
            if self.video_file_rename is not None or self.video_file_removal is not None:
                raise ValueError("文件变更范围冲突")
            valid = {"file-name": True, "file-removal": galgame.display_name is None}
        if self.resource_kind in valid:
            if (
                not valid[self.resource_kind]
                or self.expected_resource_revision < 0
                or self.asset_ids
                or self.metadata_asset_ids is not None
                or self.carried_asset_ids is not None
            ):
                raise ValueError("项目素材变更范围无效")
        elif self.video_file_rename is not None or self.video_file_removal is not None or galgame:
            raise ValueError("素材范围仅适用于项目原件变更")
        if self.galgame_project_removal and (
            self.resource_kind != "story"
            or self.expected_resource_revision < 0
            or self.asset_ids
            or self.metadata_asset_ids is not None
            or self.carried_asset_ids is not None
        ):
            raise ValueError("Galgame 项目删除范围无效")
        if self.visual_project_removal is not None and (
            self.resource_kind != "canvas"
            or self.expected_resource_revision < 0
            or self.asset_ids
            or self.metadata_asset_ids is not None
            or self.carried_asset_ids is not None
        ):
            raise ValueError("Visual 项目删除范围无效")
        if self.visual_upload is not None and (
            self.resource_kind != "canvas"
            or self.expected_resource_revision < 0
            or self.visual_project_removal is not None
            or self.metadata_asset_ids != []
            or self.carried_asset_ids != self.asset_ids
        ):
            raise ValueError("Visual 上传范围无效")
        if self.visual_evidence is not None and (
            self.resource_kind != "acceptance"
            or self.visual_evidence.source_asset_id not in self.asset_ids
            or self.metadata_asset_ids is not None
            or self.carried_asset_ids is not None
        ):
            raise ValueError("Visual 验收证据范围无效")
        if self.visual_review_project is not None and (
            self.resource_kind != "acceptance"
            or self.expected_resource_revision != -1
            or self.visual_evidence is not None
            or self.metadata_asset_ids is not None
            or self.carried_asset_ids is not None
        ):
            raise ValueError("Visual 验收记录范围无效")
        if self.visual_conversation_project is not None and self.resource_kind != "conversation":
            raise ValueError("Visual 对话范围无效")
        return self

    @field_validator(
        "asset_ids", "metadata_asset_ids", "carried_asset_ids", "visual_project_removal"
    )
    @classmethod
    def canonical_assets(cls, values):
        return ReferenceUpdate.canonical_assets(values) if values is not None else None

    def validate_service(self, service):
        if self.resource_kind not in RESOURCE_KINDS.get(service, ()):
            raise ValueError("调用方不能管理此类素材引用")
        if self.resource_kind in PROJECT_FILE_CHANGES and (
            (service == "galgame") != (self.galgame_file_mutation is not None)
        ):
            raise ValueError("素材变更命令与所属服务不符")
        if self.galgame_project_removal and service != "galgame":
            raise ValueError("项目删除命令与所属服务不符")
        if service != "visual" and (
            self.visual_project_removal is not None
            or self.visual_conversation_project is not None
            or self.visual_upload is not None
            or self.visual_evidence is not None
            or self.visual_review_project is not None
        ):
            raise ValueError("Visual 变更范围与所属服务不符")
