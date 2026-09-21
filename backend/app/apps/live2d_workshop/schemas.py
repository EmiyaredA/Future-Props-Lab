from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from app.capabilities.media_rendering.live2d.document import (
    CharacterDocument,
    Identifier,
    ValueModel,
)


class Live2DCreate(ValueModel):
    title: str = Field(default="未命名角色", min_length=1, max_length=120)
    width: int = Field(default=1200, ge=32, le=4096)
    height: int = Field(default=1600, ge=32, le=4096)


class Live2DPatch(ValueModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    title: str = Field(min_length=1, max_length=120)


class Live2DSave(ValueModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    document: CharacterDocument


class Live2DProjectOut(ValueModel):
    id: str
    title: str
    revision: int
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    thumbnail: str | None = None


class Live2DProjects(ValueModel):
    items: list[Live2DProjectOut]


class Live2DDocumentOut(ValueModel):
    revision: int
    document: CharacterDocument


class Live2DAssetOut(ValueModel):
    id: str
    name: str
    width: int
    height: int
    url: str


class Live2DAssets(ValueModel):
    items: list[Live2DAssetOut]


class Live2DCombination(ValueModel):
    expression_id: Identifier | None = Field(default=None, alias="expressionId")
    motion_id: Identifier | None = Field(default=None, alias="motionId")


class Live2DCrop(ValueModel):
    x: float = Field(ge=0, allow_inf_nan=False)
    y: float = Field(ge=0, allow_inf_nan=False)
    width: float = Field(gt=0, le=4096, allow_inf_nan=False)
    height: float = Field(gt=0, le=4096, allow_inf_nan=False)


class Live2DExportIn(ValueModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    request_id: str = Field(alias="requestId", min_length=8, max_length=64)
    combinations: list[Live2DCombination] = Field(min_length=1, max_length=16)
    width: int = Field(default=512, ge=32, le=2048)
    height: int = Field(default=512, ge=32, le=2048)
    fps: int = Field(default=30, ge=1, le=60)
    start_frame: int = Field(default=0, alias="startFrame", ge=0)
    end_frame: int = Field(default=60, alias="endFrame", ge=1, le=3600)
    crop: Live2DCrop | None = None

    @model_validator(mode="after")
    def valid_work(self) -> Live2DExportIn:
        frames = self.end_frame - self.start_frame
        if frames <= 0 or frames * len(self.combinations) > 3600:
            raise ValueError("导出范围无效或超过 3600 帧")
        if frames * len(self.combinations) * self.width * self.height > 1_000_000_000:
            raise ValueError("导出像素总量过大，请降低尺寸或分批导出")
        pairs = [(c.expression_id, c.motion_id) for c in self.combinations]
        if len(set(pairs)) != len(pairs):
            raise ValueError("表情和动作组合重复")
        return self


class Live2DPreflight(ValueModel):
    ready: bool
    messages: list[str]
    frame_count: int = Field(alias="frameCount")


class Live2DExportOut(ValueModel):
    id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress: int
    error: str | None = None
    download: str | None = None
    settings: Live2DExportIn


class Live2DExports(ValueModel):
    items: list[Live2DExportOut]
