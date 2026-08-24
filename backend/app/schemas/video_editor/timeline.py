from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator


class VideoEditorProjectSettings(BaseModel):
    width: Literal[1920] = 1920
    height: Literal[1080] = 1080
    fps: Literal[30, 60] = 30
    background_color: str = Field(
        default="#000000", alias="backgroundColor", pattern=r"^#[0-9a-fA-F]{6}$"
    )


class VideoEditorTransform(BaseModel):
    x: float = 960
    y: float = 540
    scale_x: float = Field(default=1, alias="scaleX", ge=0.01, le=20)
    scale_y: float = Field(default=1, alias="scaleY", ge=0.01, le=20)
    rotation: float = Field(default=0, ge=-3600, le=3600)
    opacity: float = Field(default=1, ge=0, le=1)


class VideoEditorKeyframe(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    property: Literal["x", "y", "scaleX", "scaleY", "rotation", "opacity", "volume"]
    time_us: int = Field(alias="timeUs", ge=0)
    value: float
    interpolation: Literal["linear", "ease-in", "ease-out", "ease-in-out"] = "linear"


class VideoEditorTransition(BaseModel):
    kind: Literal["cut", "crossfade", "fade-black", "fade-white", "audio-crossfade"]
    duration_us: int = Field(alias="durationUs", ge=0, le=10_000_000)


class VideoEditorClip(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    track_id: str = Field(alias="trackId", min_length=1, max_length=64)
    kind: Literal["video", "image", "audio", "text", "color"]
    name: str = Field(min_length=1, max_length=255)
    timeline_start_us: int = Field(alias="timelineStartUs", ge=0)
    duration_us: int = Field(alias="durationUs", gt=0)
    source_in_us: int = Field(default=0, alias="sourceInUs", ge=0)
    asset_id: str | None = Field(default=None, alias="assetId")
    text: str | None = Field(default=None, max_length=4000)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    font_asset_id: str | None = Field(default=None, alias="fontAssetId")
    font_size: int = Field(default=72, alias="fontSize", ge=8, le=400)
    text_color: str = Field(default="#ffffff", alias="textColor", pattern=r"^#[0-9a-fA-F]{6}$")
    text_max_width: int | None = Field(default=None, alias="textMaxWidth", ge=80, le=1920)
    fit_mode: Literal["native", "cover", "contain", "height"] = Field(
        default="native", alias="fitMode"
    )
    height_percent: float | None = Field(
        default=None, alias="heightPercent", gt=0, le=400
    )
    flip_x: bool = Field(default=False, alias="flipX")
    volume: float = Field(default=1, ge=0, le=4)
    transform: VideoEditorTransform = Field(default_factory=VideoEditorTransform)
    keyframes: list[VideoEditorKeyframe] = Field(default_factory=list, max_length=1000)
    transition_in: VideoEditorTransition | None = Field(default=None, alias="transitionIn")
    transition_out: VideoEditorTransition | None = Field(default=None, alias="transitionOut")
    link_group_id: str | None = Field(default=None, alias="linkGroupId", max_length=64)

    @model_validator(mode="after")
    def required_source(self) -> VideoEditorClip:
        if self.kind in {"video", "image", "audio"} and not self.asset_id:
            raise ValueError("媒体 Clip 必须引用素材")
        if self.kind == "text" and not self.text:
            raise ValueError("文字 Clip 不能为空")
        if self.kind == "color" and not self.color:
            raise ValueError("纯色 Clip 必须指定颜色")
        if any(key.time_us > self.duration_us for key in self.keyframes):
            raise ValueError("关键帧必须位于 Clip 范围内")
        return self


class VideoEditorTrack(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    kind: Literal["visual", "audio"]
    name: str = Field(min_length=1, max_length=120)
    order: int = Field(ge=0)
    locked: bool = False
    hidden: bool = False
    muted: bool = False
    clips: list[VideoEditorClip] = Field(default_factory=list)


class VideoEditorTimelineDocument(BaseModel):
    schema_version: Literal["1.0"] = Field(default="1.0", alias="schemaVersion")
    settings: VideoEditorProjectSettings = Field(default_factory=VideoEditorProjectSettings)
    tracks: list[VideoEditorTrack] = Field(default_factory=list)


class AddTrackOperation(BaseModel):
    type: Literal["addTrack"]
    track: VideoEditorTrack


class UpdateSettingsOperation(BaseModel):
    type: Literal["updateSettings"]
    patch: dict


class UpdateTrackOperation(BaseModel):
    type: Literal["updateTrack"]
    track_id: str = Field(alias="trackId")
    patch: dict


class RemoveTrackOperation(BaseModel):
    type: Literal["removeTrack"]
    track_id: str = Field(alias="trackId")


class ReorderTrackOperation(BaseModel):
    type: Literal["reorderTrack"]
    track_id: str = Field(alias="trackId")
    order: int = Field(ge=0)


class AddClipOperation(BaseModel):
    type: Literal["addClip"]
    clip: VideoEditorClip


class UpdateClipOperation(BaseModel):
    type: Literal["updateClip"]
    clip_id: str = Field(alias="clipId")
    patch: dict


class ClipIdOperation(BaseModel):
    type: Literal["removeClip", "duplicateClip", "rippleDelete", "unlinkClips"]
    clip_id: str = Field(alias="clipId")
    new_clip_id: str | None = Field(default=None, alias="newClipId")


class MoveClipOperation(BaseModel):
    type: Literal["moveClip"]
    clip_id: str = Field(alias="clipId")
    track_id: str = Field(alias="trackId")
    timeline_start_us: int = Field(alias="timelineStartUs", ge=0)


class TrimClipOperation(BaseModel):
    type: Literal["trimClip"]
    clip_id: str = Field(alias="clipId")
    timeline_start_us: int = Field(alias="timelineStartUs", ge=0)
    duration_us: int = Field(alias="durationUs", gt=0)
    source_in_us: int = Field(alias="sourceInUs", ge=0)


class SplitClipOperation(BaseModel):
    type: Literal["splitClip"]
    clip_id: str = Field(alias="clipId")
    at_us: int = Field(alias="atUs", gt=0)
    new_clip_id: str = Field(alias="newClipId")


class LinkClipsOperation(BaseModel):
    type: Literal["linkClips"]
    clip_ids: list[str] = Field(alias="clipIds", min_length=2)
    link_group_id: str = Field(alias="linkGroupId")


class KeyframeOperation(BaseModel):
    type: Literal["addKeyframe", "updateKeyframe", "removeKeyframe"]
    clip_id: str = Field(alias="clipId")
    keyframe: VideoEditorKeyframe | None = None
    keyframe_id: str | None = Field(default=None, alias="keyframeId")

    @model_validator(mode="after")
    def required_keyframe_fields(self) -> KeyframeOperation:
        if self.type in {"addKeyframe", "updateKeyframe"} and self.keyframe is None:
            raise ValueError("新增或更新关键帧必须提交 keyframe")
        if self.type == "removeKeyframe" and not self.keyframe_id:
            raise ValueError("删除关键帧必须提交 keyframeId")
        return self


class SetTransitionOperation(BaseModel):
    type: Literal["setTransition"]
    clip_id: str = Field(alias="clipId")
    edge: Literal["in", "out"]
    transition: VideoEditorTransition | None = None


VideoEditorTimelineOperation = Annotated[
    AddTrackOperation
    | UpdateSettingsOperation
    | UpdateTrackOperation
    | RemoveTrackOperation
    | ReorderTrackOperation
    | AddClipOperation
    | UpdateClipOperation
    | ClipIdOperation
    | MoveClipOperation
    | TrimClipOperation
    | SplitClipOperation
    | LinkClipsOperation
    | KeyframeOperation
    | SetTransitionOperation,
    Field(discriminator="type"),
]


class VideoEditorTimelineBatchIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    request_id: str = Field(alias="requestId", min_length=8, max_length=64)
    operations: list[VideoEditorTimelineOperation] = Field(min_length=1, max_length=200)


class VideoEditorTimelineOut(BaseModel):
    project_id: str = Field(alias="projectId")
    revision: int
    document: VideoEditorTimelineDocument
    updated_at: str = Field(alias="updatedAt")
