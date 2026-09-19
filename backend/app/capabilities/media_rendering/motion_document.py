"""Portable motion composition document shared by editor validation and rendering."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class MotionModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class MotionSettings(MotionModel):
    width: Literal[1920, 1080] = 1920
    height: Literal[1080, 1920] = 1080
    fps: Literal[30, 60] = 30
    duration_frames: int = Field(default=180, alias="durationFrames", ge=1, le=3600)
    background_color: str = Field(
        default="#111318", alias="backgroundColor", pattern=r"^#[0-9A-Fa-f]{6}$"
    )

    @model_validator(mode="after")
    def valid_size(self) -> MotionSettings:
        if (self.width, self.height) not in {(1920, 1080), (1080, 1920), (1080, 1080)}:
            raise ValueError("不支持此画幅")
        return self


class MotionPoint(MotionModel):
    x: float
    y: float
    in_x: float = Field(default=0, alias="inX")
    in_y: float = Field(default=0, alias="inY")
    out_x: float = Field(default=0, alias="outX")
    out_y: float = Field(default=0, alias="outY")


class MotionMaskFrame(MotionModel):
    frame: int = Field(ge=0)
    points: list[MotionPoint] = Field(min_length=3, max_length=80)


class MotionMask(MotionModel):
    points: list[MotionPoint] = Field(min_length=3, max_length=80)
    keyframes: list[MotionMaskFrame] = Field(default_factory=list)
    feather: int = Field(default=0, ge=0, le=32)
    inverted: bool = False

    @model_validator(mode="after")
    def matching_vertices(self) -> MotionMask:
        count = len(self.points)
        if any(len(frame.points) != count for frame in self.keyframes):
            raise ValueError("遮罩关键帧的控制点数量必须相同")
        frames = [frame.frame for frame in self.keyframes]
        if len(frames) != len(set(frames)):
            raise ValueError("遮罩关键帧不能重复")
        return self


class MotionKeyframe(MotionModel):
    id: str = Field(min_length=1, max_length=64)
    frame: int = Field(ge=0)
    property: Literal["x", "y", "scaleX", "scaleY", "rotation", "opacity"]
    value: float
    interpolation: Literal["linear", "ease-in", "ease-out", "ease-in-out", "hold"] = "linear"


class MotionTransform(MotionModel):
    x: float = 0
    y: float = 0
    scale_x: float = Field(default=1, alias="scaleX", ge=0.01, le=20)
    scale_y: float = Field(default=1, alias="scaleY", ge=0.01, le=20)
    rotation: float = 0
    opacity: float = Field(default=1, ge=0, le=1)


class MotionEffects(MotionModel):
    outline: int = Field(default=0, ge=0, le=30)
    shadow: int = Field(default=0, ge=0, le=100)
    halftone: int = Field(default=0, ge=0, le=40)
    duotone: bool = False


class MotionLayer(MotionModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["image", "video", "text", "shape"]
    visible: bool = True
    locked: bool = False
    start_frame: int = Field(default=0, alias="startFrame", ge=0)
    end_frame: int = Field(default=180, alias="endFrame", ge=1)
    source_start_us: int = Field(default=0, alias="sourceStartUs", ge=0)
    asset_id: str | None = Field(default=None, alias="assetId")
    text: str = Field(default="", max_length=1000)
    font_size: int = Field(default=96, alias="fontSize", ge=8, le=500)
    shape: Literal["rect", "ellipse", "triangle", "speedLines"] = "rect"
    width: int = Field(default=500, ge=1, le=4000)
    height: int = Field(default=300, ge=1, le=4000)
    fill: str = Field(default="#ffffff", pattern=r"^#[0-9A-Fa-f]{6}$")
    stroke: str = Field(default="#111318", pattern=r"^#[0-9A-Fa-f]{6}$")
    transform: MotionTransform = Field(default_factory=MotionTransform)
    mask: MotionMask | None = None
    effects: MotionEffects = Field(default_factory=MotionEffects)
    keyframes: list[MotionKeyframe] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_timing(self) -> MotionLayer:
        if self.end_frame <= self.start_frame:
            raise ValueError("图层结束帧必须晚于开始帧")
        if self.kind in {"image", "video"} and not self.asset_id:
            raise ValueError("媒体图层缺少素材")
        keys = [(key.property, key.frame) for key in self.keyframes]
        if len(keys) != len(set(keys)) or len({key.id for key in self.keyframes}) != len(
            self.keyframes
        ):
            raise ValueError("关键帧不能重复")
        duration = self.end_frame - self.start_frame
        if any(key.frame >= duration for key in self.keyframes):
            raise ValueError("关键帧超出图层时间范围")
        if self.mask and any(key.frame >= duration for key in self.mask.keyframes):
            raise ValueError("遮罩关键帧超出图层时间范围")
        return self


class MotionComposition(MotionModel):
    schema_version: Literal[1] = Field(default=1, alias="schemaVersion")
    settings: MotionSettings = Field(default_factory=MotionSettings)
    layers: list[MotionLayer] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def valid_layers(self) -> MotionComposition:
        if len({layer.id for layer in self.layers}) != len(self.layers):
            raise ValueError("图层 ID 不能重复")
        if any(layer.end_frame > self.settings.duration_frames for layer in self.layers):
            raise ValueError("图层超出项目时长")
        return self
