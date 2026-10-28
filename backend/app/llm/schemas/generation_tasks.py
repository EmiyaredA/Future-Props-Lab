"""Shared generation task request shapes used by visual workshop and model inference."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.llm.schemas.workflow_video import WorkflowVideoParameters

GenerationTaskStatus = Literal[
    "queued", "submitting", "pending", "processing", "completed", "failed"
]


class ImageGenerationTaskCreateIn(BaseModel):
    kind: Literal["image"]
    model_id: str
    prompt: str = Field(min_length=1, max_length=6000)
    size: str = Field(default="1024x1024", max_length=32)
    seed: int | None = Field(default=None, ge=0)
    reference_asset_id: str | None = None
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=14)
    canvas_node_id: str | None = Field(default=None, min_length=1, max_length=64)
    expected_canvas_revision: int | None = Field(default=None, ge=0)

    @field_validator("prompt")
    @classmethod
    def prompt_is_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("提示词不能为空")
        return cleaned

    @model_validator(mode="after")
    def canvas_link_is_complete(self) -> ImageGenerationTaskCreateIn:
        if len(self.reference_asset_ids) != len(set(self.reference_asset_ids)):
            raise ValueError("参考图片不能重复")
        if (self.canvas_node_id is None) != (self.expected_canvas_revision is None):
            raise ValueError("画布节点和画布版本必须同时提供")
        return self


class VideoGenerationTaskCreateIn(BaseModel):
    kind: Literal["video"]
    model_id: str
    prompt: str = Field(default="", max_length=20000)
    mode: Literal["text", "frames", "reference"] = "text"
    duration: int = Field(default=5, ge=-1, le=30)
    resolution: (
        Literal["480p", "720p", "1080p", "4k", "768p", "960p", "464x832", "832x464"] | None
    ) = None
    ratio: Literal["16:9", "9:16", "4:3", "3:4", "1:1", "21:9", "adaptive"] | None = None
    watermark: bool | None = None
    generate_audio: bool | None = None
    first_frame_asset_id: str | None = None
    last_frame_asset_id: str | None = None
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=30)
    audio_asset_ids: list[str] = Field(default_factory=list, max_length=10)
    video_asset_ids: list[str] = Field(default_factory=list, max_length=10)
    workflow_parameters: WorkflowVideoParameters | None = None
    canvas_node_id: str | None = Field(default=None, min_length=1, max_length=64)
    expected_canvas_revision: int | None = Field(default=None, ge=0)

    @field_validator("prompt")
    @classmethod
    def clean_prompt(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def valid_content_mode(self) -> VideoGenerationTaskCreateIn:
        if (self.canvas_node_id is None) != (self.expected_canvas_revision is None):
            raise ValueError("画布节点和画布版本必须同时提供")
        asset_ids = [
            item
            for item in (
                self.first_frame_asset_id,
                self.last_frame_asset_id,
                *self.reference_asset_ids,
                *self.audio_asset_ids,
                *self.video_asset_ids,
            )
            if item
        ]
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("参考素材不能重复")
        if self.mode == "text":
            if not self.prompt:
                raise ValueError("纯文本模式必须填写提示词")
            if any(
                (
                    self.first_frame_asset_id,
                    self.last_frame_asset_id,
                    self.reference_asset_ids,
                    self.audio_asset_ids,
                    self.video_asset_ids,
                )
            ):
                raise ValueError("纯文本模式不能携带参考素材")
        elif self.mode == "frames":
            if not self.first_frame_asset_id:
                raise ValueError("首尾帧模式必须选择首帧")
            if self.reference_asset_ids or self.audio_asset_ids or self.video_asset_ids:
                raise ValueError("首尾帧模式不能与参考素材模式混用")
        else:
            if self.first_frame_asset_id or self.last_frame_asset_id:
                raise ValueError("参考素材模式不能携带首尾帧")
            if not (self.reference_asset_ids or self.audio_asset_ids or self.video_asset_ids):
                raise ValueError("参考素材模式至少需要一个素材")
        return self


class AudioGenerationTaskCreateIn(BaseModel):
    kind: Literal["audio"]
    model_id: str
    mode: Literal["music", "sfx"] = "music"
    prompt: str = Field(min_length=1, max_length=6000)
    theme: str = Field(default="", max_length=500)
    style: str = Field(default="", max_length=500)
    duration: int | None = Field(default=None, ge=1, le=600)
    smart_duration: bool = True
    prompt_influence: float = Field(default=0.5, ge=0, le=1)
    output_format: Literal["mp3", "wav"] = "mp3"
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=3)
    canvas_node_id: str | None = Field(default=None, min_length=1, max_length=64)
    expected_canvas_revision: int | None = Field(default=None, ge=0)

    @field_validator("prompt")
    @classmethod
    def clean_audio_prompt(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("提示词不能为空")
        return cleaned

    @model_validator(mode="after")
    def valid_audio_request(self) -> AudioGenerationTaskCreateIn:
        if (self.canvas_node_id is None) != (self.expected_canvas_revision is None):
            raise ValueError("画布节点和画布版本必须同时提供")
        if len(self.reference_asset_ids) != len(set(self.reference_asset_ids)):
            raise ValueError("参考音频不能重复")
        if self.mode == "sfx":
            if len(self.prompt) > 2000:
                raise ValueError("音效提示词不能超过 2000 个字符")
            if self.reference_asset_ids:
                raise ValueError("音效生成不接收参考音频")
            if not self.smart_duration and self.duration is None:
                raise ValueError("固定时长音效必须填写时长")
            if self.duration is not None and self.duration > 10:
                raise ValueError("音效时长不能超过 10 秒")
        return self


GenerationTaskCreateIn = Annotated[
    ImageGenerationTaskCreateIn | VideoGenerationTaskCreateIn | AudioGenerationTaskCreateIn,
    Field(discriminator="kind"),
]
