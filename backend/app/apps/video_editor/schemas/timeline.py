from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.capabilities.media_rendering.timeline_document import (
    VideoEditorAssetOrganization,
    VideoEditorClip,
    VideoEditorKeyframe,
    VideoEditorTimelineDocument,
    VideoEditorTrack,
    VideoEditorTransition,
)


class AddTrackOperation(BaseModel):
    type: Literal["addTrack"]
    track: VideoEditorTrack


class UpdateSettingsOperation(BaseModel):
    type: Literal["updateSettings"]
    patch: dict


class SetAssetOrganizationOperation(BaseModel):
    type: Literal["setAssetOrganization"]
    organization: VideoEditorAssetOrganization


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


class SetClipSpeedOperation(BaseModel):
    type: Literal["setClipSpeed"]
    clip_id: str = Field(alias="clipId")
    playback_rate: float = Field(alias="playbackRate", ge=0.25, le=4)
    ripple: bool = False


class RestoreClipStatesOperation(BaseModel):
    type: Literal["restoreClipStates"]
    clips: list[VideoEditorClip] = Field(min_length=1)

    @field_validator("clips")
    @classmethod
    def unique_clips(cls, clips: list[VideoEditorClip]) -> list[VideoEditorClip]:
        if len({clip.id for clip in clips}) != len(clips):
            raise ValueError("恢复片段 ID 不得重复")
        return clips


class SplitClipOperation(BaseModel):
    type: Literal["splitClip"]
    clip_id: str = Field(alias="clipId")
    at_us: int = Field(alias="atUs", gt=0)
    new_clip_id: str = Field(alias="newClipId")
    linked_new_clip_ids: dict[str, str] = Field(default_factory=dict, alias="linkedNewClipIds")
    new_link_group_id: str | None = Field(
        default=None, alias="newLinkGroupId", min_length=1, max_length=64
    )

    @field_validator("linked_new_clip_ids")
    @classmethod
    def valid_linked_ids(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 100 or any(
            not key.strip() or not item.strip() for key, item in value.items()
        ):
            raise ValueError("关联分割的 Clip ID 不能为空")
        if len(value.values()) != len(set(value.values())):
            raise ValueError("关联分割的新 Clip ID 不能重复")
        return value


class LinkClipsOperation(BaseModel):
    type: Literal["linkClips"]
    clip_ids: list[str] = Field(alias="clipIds", min_length=2)
    link_group_id: str = Field(alias="linkGroupId")


class SeparateClipOperation(BaseModel):
    type: Literal["separateClip"]
    clip_id: str = Field(alias="clipId")
    visual_track_id: str = Field(alias="visualTrackId")
    audio_track_id: str = Field(alias="audioTrackId")
    audio_clip_id: str = Field(alias="audioClipId", min_length=1, max_length=64)


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
    | SetAssetOrganizationOperation
    | UpdateTrackOperation
    | RemoveTrackOperation
    | ReorderTrackOperation
    | AddClipOperation
    | UpdateClipOperation
    | ClipIdOperation
    | MoveClipOperation
    | TrimClipOperation
    | SplitClipOperation
    | SetClipSpeedOperation
    | RestoreClipStatesOperation
    | LinkClipsOperation
    | SeparateClipOperation
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
