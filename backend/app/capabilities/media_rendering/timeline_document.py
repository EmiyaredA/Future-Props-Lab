from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class VideoEditorProjectSettings(BaseModel):
    width: Literal[1920] = 1920
    height: Literal[1080] = 1080
    fps: Literal[30, 60] = 30
    background_color: str = Field(
        default="#000000", alias="backgroundColor", pattern=r"^#[0-9a-fA-F]{6}$"
    )
    video_fit_policy_version: Literal[0, 1] | None = Field(
        default=None, alias="videoFitPolicyVersion"
    )


class VideoEditorAssetFolder(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    asset_ids: list[str] = Field(default_factory=list, alias="assetIds", max_length=10_000)

    @field_validator("name")
    @classmethod
    def normalized_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("素材文件夹名称不能为空")
        return normalized

    @field_validator("asset_ids")
    @classmethod
    def valid_asset_ids(cls, value: list[str]) -> list[str]:
        if any(not asset_id.strip() or len(asset_id) > 64 for asset_id in value):
            raise ValueError("素材 ID 无效")
        return value


class VideoEditorAssetOrganization(BaseModel):
    folders: list[VideoEditorAssetFolder] = Field(default_factory=list, max_length=100)
    root_asset_ids: list[str] = Field(default_factory=list, alias="rootAssetIds", max_length=10_000)

    @model_validator(mode="after")
    def unique_folders_and_assets(self) -> VideoEditorAssetOrganization:
        folder_ids = [folder.id for folder in self.folders]
        if len(folder_ids) != len(set(folder_ids)):
            raise ValueError("素材文件夹 ID 必须唯一")
        names = [folder.name.casefold() for folder in self.folders]
        if len(names) != len(set(names)):
            raise ValueError("素材文件夹名称不能重复")
        asset_ids = [*self.root_asset_ids]
        for folder in self.folders:
            asset_ids.extend(folder.asset_ids)
        if any(not asset_id.strip() or len(asset_id) > 64 for asset_id in asset_ids):
            raise ValueError("素材 ID 无效")
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("同一素材只能出现在一个文件夹位置")
        return self


class VideoEditorTransform(BaseModel):
    x: float = 960
    y: float = 540
    anchor: Literal["center", "topLeft", "bottomCenter"] = "center"
    scale_x: float = Field(default=1, alias="scaleX", ge=0.01, le=20)
    scale_y: float = Field(default=1, alias="scaleY", ge=0.01, le=20)
    rotation: float = Field(default=0, ge=-3600, le=3600)
    opacity: float = Field(default=1, ge=0, le=1)
    brightness: float = Field(default=1, ge=0, le=2)


class VideoEditorKeyframe(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    property: Literal["x", "y", "scaleX", "scaleY", "rotation", "opacity", "brightness", "volume"]
    time_us: int = Field(alias="timeUs", ge=0)
    value: float
    interpolation: Literal["linear", "ease-in", "ease-out", "ease-in-out"] = "linear"


class VideoEditorTransition(BaseModel):
    kind: Literal["cut", "crossfade", "fade-black", "fade-white", "audio-crossfade"]
    duration_us: int = Field(alias="durationUs", ge=0, le=10_000_000)


class VideoEditorTextStyle(BaseModel):
    align: Literal["left", "center", "right"] = "center"
    stroke_color: str = Field(default="#000000", alias="strokeColor", pattern=r"^#[0-9a-fA-F]{6}$")
    stroke_width: int = Field(default=0, alias="strokeWidth", ge=0, le=20)
    background_color: str = Field(
        default="#000000", alias="backgroundColor", pattern=r"^#[0-9a-fA-F]{6}$"
    )
    background_opacity: float = Field(default=0, alias="backgroundOpacity", ge=0, le=1)


class VideoEditorClip(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    track_id: str = Field(alias="trackId", min_length=1, max_length=64)
    kind: Literal["video", "image", "audio", "text", "color"]
    name: str = Field(min_length=1, max_length=255)
    timeline_start_us: int = Field(alias="timelineStartUs", ge=0)
    duration_us: int = Field(alias="durationUs", gt=0)
    source_in_us: int = Field(default=0, alias="sourceInUs", ge=0)
    playback_rate: float | None = Field(default=None, alias="playbackRate", ge=0.25, le=4)
    source_loop: bool = Field(default=False, alias="sourceLoop")
    asset_id: str | None = Field(default=None, alias="assetId")
    text: str | None = Field(default=None, max_length=4000)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    font_asset_id: str | None = Field(default=None, alias="fontAssetId")
    font_size: int = Field(default=72, alias="fontSize", ge=8, le=400)
    text_color: str = Field(default="#ffffff", alias="textColor", pattern=r"^#[0-9a-fA-F]{6}$")
    text_max_width: int | None = Field(default=None, alias="textMaxWidth", ge=80, le=1920)
    text_style: VideoEditorTextStyle | None = Field(default=None, alias="textStyle")
    fit_mode: Literal["native", "cover", "contain", "height"] = Field(
        default="cover", alias="fitMode"
    )
    height_percent: float | None = Field(default=None, alias="heightPercent", gt=0, le=400)
    flip_x: bool = Field(default=False, alias="flipX")
    volume: float = Field(default=1, ge=0, le=4)
    muted: bool | None = None
    transform: VideoEditorTransform = Field(default_factory=VideoEditorTransform)
    keyframes: list[VideoEditorKeyframe] = Field(default_factory=list, max_length=1000)
    transition_in: VideoEditorTransition | None = Field(default=None, alias="transitionIn")
    transition_out: VideoEditorTransition | None = Field(default=None, alias="transitionOut")
    link_group_id: str | None = Field(default=None, alias="linkGroupId", max_length=64)

    @model_validator(mode="after")
    def required_source(self) -> VideoEditorClip:
        if self.kind not in {"video", "audio"} and self.playback_rate not in {None, 1}:
            raise ValueError("只有视频和音频 Clip 可以变速")
        if self.kind in {"video", "image", "audio"} and not self.asset_id:
            raise ValueError("媒体 Clip 必须引用素材")
        if self.kind == "text" and not (self.text or "").strip():
            raise ValueError("文字 Clip 不能为空")
        if self.kind == "color" and not self.color:
            raise ValueError("纯色 Clip 必须指定颜色")
        if any(key.time_us > self.duration_us for key in self.keyframes):
            raise ValueError("关键帧必须位于 Clip 范围内")
        return self


class VideoEditorTrack(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    kind: Literal["visual", "audio", "mixed"]
    name: str = Field(min_length=1, max_length=120)
    order: int = Field(ge=0)
    locked: bool = False
    hidden: bool = False
    muted: bool = False
    clips: list[VideoEditorClip] = Field(default_factory=list)


class VideoEditorTimelineDocument(BaseModel):
    schema_version: Literal["1.0"] = Field(default="1.0", alias="schemaVersion")
    settings: VideoEditorProjectSettings = Field(default_factory=VideoEditorProjectSettings)
    asset_organization: VideoEditorAssetOrganization = Field(
        default_factory=VideoEditorAssetOrganization, alias="assetOrganization"
    )
    tracks: list[VideoEditorTrack] = Field(default_factory=list)
