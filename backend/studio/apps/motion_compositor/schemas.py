from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.capabilities.media_rendering.motion_document import MotionComposition, MotionLayer


class ProjectCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    aspect: Literal["16:9", "9:16", "1:1"] = "16:9"
    fps: Literal[30, 60] = 30
    starter: Literal["blank", "comic-entry"] = "blank"

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("项目名称不能为空")
        return value.strip()


class ProjectPatchIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    title: str = Field(min_length=1, max_length=120)


class ProjectOut(BaseModel):
    id: str
    title: str
    revision: int
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class ProjectListOut(BaseModel):
    items: list[ProjectOut]


class DocumentOut(BaseModel):
    revision: int
    document: MotionComposition


class MotionOperation(BaseModel):
    type: Literal[
        "addLayer",
        "updateLayer",
        "removeLayer",
        "reorderLayers",
        "updateSettings",
        "replaceDocument",
    ]
    layer: MotionLayer | None = None
    layer_id: str | None = Field(default=None, alias="layerId")
    patch: dict | None = None
    layer_ids: list[str] | None = Field(default=None, alias="layerIds")
    document: MotionComposition | None = None


class OperationBatchIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    request_id: str = Field(alias="requestId", min_length=8, max_length=64)
    operations: list[MotionOperation] = Field(min_length=1, max_length=100)


class AssetImportIn(BaseModel):
    asset_ids: list[str] = Field(alias="assetIds", min_length=1, max_length=100)

    @field_validator("asset_ids")
    @classmethod
    def unique_assets(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("素材 ID 不能重复")
        return value


class AssetOut(BaseModel):
    id: str
    display_name: str = Field(alias="displayName")
    media_kind: str = Field(alias="mediaKind")
    mime_type: str = Field(alias="mimeType")
    url: str


class AssetListOut(BaseModel):
    items: list[AssetOut]


class ImportSourceOut(BaseModel):
    id: str
    display_name: str = Field(alias="displayName")
    media_kind: str = Field(alias="mediaKind")
    source_application: str = Field(alias="sourceApplication")


class ImportSourceListOut(BaseModel):
    items: list[ImportSourceOut]


class ExportCreateIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    request_id: str = Field(alias="requestId", min_length=8, max_length=64)
    formats: list[Literal["mp4", "mov4444", "png-sequence"]] = Field(min_length=1, max_length=3)
    start_frame: int = Field(default=0, alias="startFrame", ge=0)
    end_frame: int | None = Field(default=None, alias="endFrame", gt=0)

    @model_validator(mode="after")
    def valid_range(self) -> ExportCreateIn:
        if len(set(self.formats)) != len(self.formats):
            raise ValueError("导出格式不能重复")
        if self.end_frame is not None and self.end_frame <= self.start_frame:
            raise ValueError("结束帧必须晚于开始帧")
        return self


class ExportOut(BaseModel):
    id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress: int
    formats: list[str]
    outputs: dict[str, str]
    error: str | None


class ExportListOut(BaseModel):
    items: list[ExportOut]


class HandoffIn(BaseModel):
    format: Literal["mp4", "mov4444"]
    target_project_id: str | None = Field(default=None, alias="targetProjectId")
    new_project_title: str | None = Field(default=None, alias="newProjectTitle")

    @model_validator(mode="after")
    def one_target(self) -> HandoffIn:
        if (self.target_project_id is None) == (self.new_project_title is None):
            raise ValueError("请选择已有剪辑项目或新项目名称")
        return self


class HandoffOut(BaseModel):
    project_id: str = Field(alias="projectId")
    asset_id: str = Field(alias="assetId")
