from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from app.llm.schemas.model_test_tools import ModelTestToolCallOut, ModelTestToolSummaryOut
from app.capabilities.transcription.schemas import (
    ModelTestTranscriptionLanguageOptionOut as ModelTestTranscriptionLanguageOptionOut,
)
from app.capabilities.transcription.schemas import (
    ModelTestTranscriptionParameterCapabilitiesOut,
    ModelTestTranscriptionParametersIn,
    ModelTestTranscriptionParametersOut,
)

MessageStatus = Literal["pending", "completed", "error", "cancelled", "superseded"]


class ModelTestAttachmentOut(BaseModel):
    id: str
    original_filename: str
    mime_type: Literal["image/jpeg", "image/png", "image/webp", "image/gif"]
    byte_size: int
    width: int
    height: int
    created_at: str


class ModelTestAttachmentListOut(BaseModel):
    items: list[ModelTestAttachmentOut]


class ModelTestGenerationAssetOut(BaseModel):
    id: str
    original_filename: str
    media_kind: Literal["image", "audio", "video"]
    mime_type: str
    byte_size: int
    claimed: bool
    created_at: str


class ModelTestGenerationAssetListOut(BaseModel):
    items: list[ModelTestGenerationAssetOut]


class ModelTestGenerationAssetCleanupOut(BaseModel):
    deleted_assets: int
    deleted_orphan_files: int


class ModelTestGenerationAssetBackfillStatusOut(BaseModel):
    pending_tasks: int
    eligible_tasks: int
    active_tasks: int
    missing_files: int


class ModelTestGenerationAssetBackfillOut(BaseModel):
    processed_tasks: int
    copied_assets: int
    skipped_active: int
    skipped_missing: int
    conflicts: int
    remaining_tasks: int


class ModelTestMessageOut(BaseModel):
    id: str
    turn_id: str
    role: Literal["user", "assistant"]
    content: str
    model_slug: str
    status: MessageStatus
    error_message: str | None
    created_at: str
    attachments: list[ModelTestAttachmentOut] = Field(default_factory=list)
    tool_calls: list[ModelTestToolCallOut] = Field(default_factory=list)


class ModelTestConversationSummaryOut(BaseModel):
    id: str
    title: str
    model_id: str | None
    model_slug: str
    revision: int
    created_at: str
    updated_at: str


class ModelTestConversationOut(ModelTestConversationSummaryOut):
    system_prompt: str
    temperature: float
    max_tokens: int
    messages: list[ModelTestMessageOut]
    draft_attachments: list[ModelTestAttachmentOut] = Field(default_factory=list)
    tools: list[ModelTestToolSummaryOut] = Field(default_factory=list)


class ModelTestConversationListOut(BaseModel):
    items: list[ModelTestConversationSummaryOut]


class ModelTestConversationCreateIn(BaseModel):
    model_id: str | None = None


class ModelTestConversationPatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    model_id: str | None = None
    system_prompt: str | None = Field(default=None, max_length=20000)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=8192)
    tool_ids: list[str] | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def has_change(self) -> ModelTestConversationPatchIn:
        if not any(
            value is not None
            for value in (
                self.title,
                self.model_id,
                self.system_prompt,
                self.temperature,
                self.max_tokens,
                self.tool_ids,
            )
        ):
            raise ValueError("至少需要提供一个修改字段")
        if self.tool_ids is not None and len(set(self.tool_ids)) != len(self.tool_ids):
            raise ValueError("测试工具不能重复")
        return self


class ModelTestDeleteIn(BaseModel):
    expected_revision: int = Field(ge=0)


class ModelTestSendIn(BaseModel):
    expected_revision: int = Field(ge=0)
    content: str = Field(default="", max_length=100000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def has_content(self) -> ModelTestSendIn:
        self.content = self.content.strip()
        if not self.content and not self.attachment_ids:
            raise ValueError("消息文本和图片附件不能同时为空")
        if len(set(self.attachment_ids)) != len(self.attachment_ids):
            raise ValueError("图片附件不能重复")
        return self


class ModelTestRegenerateIn(BaseModel):
    expected_revision: int = Field(ge=0)


GenerationTaskStatus = Literal[
    "queued", "submitting", "pending", "processing", "completed", "failed"
]


class ModelTestImageGenerationIn(BaseModel):
    kind: Literal["image"]
    model_id: str
    prompt: str = Field(min_length=1, max_length=6000)
    size: str = Field(default="1024x1024", max_length=32)
    seed: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def clean_prompt(self) -> ModelTestImageGenerationIn:
        self.prompt = self.prompt.strip()
        if not self.prompt:
            raise ValueError("提示词不能为空")
        return self


class ModelTestVideoGenerationIn(BaseModel):
    kind: Literal["video"]
    model_id: str
    prompt: str = Field(min_length=1, max_length=6000)
    duration: int = Field(default=5, ge=4, le=15)
    resolution: Literal["480p", "720p", "1080p"] = "720p"
    ratio: Literal["16:9", "9:16", "4:3", "3:4", "1:1"] = "16:9"
    watermark: bool = True
    generate_audio: bool = False
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=9)
    audio_asset_ids: list[str] = Field(default_factory=list, max_length=3)
    video_asset_ids: list[str] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def clean_prompt(self) -> ModelTestVideoGenerationIn:
        self.prompt = self.prompt.strip()
        if not self.prompt:
            raise ValueError("提示词不能为空")
        all_asset_ids = [
            *self.reference_asset_ids,
            *self.audio_asset_ids,
            *self.video_asset_ids,
        ]
        if len(all_asset_ids) != len(set(all_asset_ids)):
            raise ValueError("参考素材不能重复")
        if self.audio_asset_ids and not (self.reference_asset_ids or self.video_asset_ids):
            raise ValueError("参考音频必须搭配参考图片或视频")
        return self


ModelTestGenerationCreateIn = Annotated[
    ModelTestImageGenerationIn | ModelTestVideoGenerationIn,
    Field(discriminator="kind"),
]


class ModelTestGenerationTaskOut(BaseModel):
    id: str
    provider_id: str | None
    model_id: str | None
    provider_kind: Literal["senseaudio_image", "senseaudio_video"]
    kind: Literal["image", "video"]
    provider_name: str
    model_slug: str
    request_payload: dict
    status: GenerationTaskStatus
    progress: int
    error_message: str | None
    result_filename: str | None
    result_mime_type: str | None
    result_byte_size: int | None
    result_available: bool
    can_retry_materialization: bool
    log_id: str | None
    revision: int
    created_at: str
    updated_at: str
    completed_at: str | None


class ModelTestGenerationTaskListOut(BaseModel):
    items: list[ModelTestGenerationTaskOut]
    total: int


class ModelTestGenerationOptionOut(BaseModel):
    id: str
    provider_id: str
    provider_name: str
    kind: Literal["image", "video"]
    slug: str
    label: str
    description: str
    sizes: list[str] = Field(default_factory=list)


class ModelTestGenerationOptionListOut(BaseModel):
    items: list[ModelTestGenerationOptionOut]


TranscriptionTaskStatus = Literal["queued", "running", "completed", "failed"]


class ModelTestTranscriptionCreateIn(ModelTestTranscriptionParametersIn):
    model_id: str
    source_asset_id: str


class ModelTestTranscriptionWordOut(BaseModel):
    word: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)


class ModelTestTranscriptionWarningOut(BaseModel):
    stage: str | None = None
    code: str
    message: str


class ModelTestTranscriptionStageOut(BaseModel):
    name: str
    status: Literal["success", "degraded", "failed", "skipped", "unknown"]


class ModelTestTranscriptionIntervalOut(BaseModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)


class ModelTestTranscriptionAudioInfoOut(BaseModel):
    duration_ms: int | None = Field(default=None, ge=0)
    format: str | None = None


class ModelTestTranscriptionResultDetailOut(BaseModel):
    audio_info: ModelTestTranscriptionAudioInfoOut | None = None
    words: list[ModelTestTranscriptionWordOut] = Field(default_factory=list)
    processing_status: Literal["success", "degraded", "failed", "unknown"] = "unknown"
    stages: list[ModelTestTranscriptionStageOut] = Field(default_factory=list)
    warnings: list[ModelTestTranscriptionWarningOut] = Field(default_factory=list)
    overlap_intervals: list[ModelTestTranscriptionIntervalOut] = Field(default_factory=list)


class ModelTestTranscriptionSegmentOut(BaseModel):
    speaker: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    text: str
    translation: str | None = None
    speaker_candidates: list[str] = Field(default_factory=list)
    is_overlap: bool = False


class ModelTestTranscriptionSourceOut(BaseModel):
    kind: Literal["upload", "library"]
    source_asset_id: str | None
    filename: str
    mime_type: str
    byte_size: int
    available: bool


class ModelTestTranscriptionTaskOut(BaseModel):
    id: str
    provider_id: str | None
    model_id: str | None
    provider_kind: Literal["openai", "senseaudio_asr", "senseaudio_asr_pro"]
    provider_name: str
    model_slug: str
    language: str
    parameters: ModelTestTranscriptionParametersOut
    status: TranscriptionTaskStatus
    source: ModelTestTranscriptionSourceOut
    result_text: str | None
    result_segments: list[ModelTestTranscriptionSegmentOut]
    result_detail: ModelTestTranscriptionResultDetailOut
    error_message: str | None
    log_id: str | None
    revision: int
    created_at: str
    updated_at: str
    started_at: str | None
    completed_at: str | None


class ModelTestTranscriptionTaskListOut(BaseModel):
    items: list[ModelTestTranscriptionTaskOut]
    total: int


class ModelTestTranscriptionOptionOut(BaseModel):
    id: str
    provider_id: str
    provider_name: str
    provider_kind: Literal["openai", "senseaudio_asr", "senseaudio_asr_pro"]
    slug: str
    label: str
    description: str
    max_input_bytes: int = Field(gt=0)
    parameter_capabilities: ModelTestTranscriptionParameterCapabilitiesOut


class ModelTestTranscriptionOptionListOut(BaseModel):
    items: list[ModelTestTranscriptionOptionOut]
    max_input_bytes: int
    accepted_extensions: list[str]
    accepted_mime_types: list[str]
