from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

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
            )
        ):
            raise ValueError("至少需要提供一个修改字段")
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
    def clean_prompt(self) -> "ModelTestImageGenerationIn":
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

    @model_validator(mode="after")
    def clean_prompt(self) -> "ModelTestVideoGenerationIn":
        self.prompt = self.prompt.strip()
        if not self.prompt:
            raise ValueError("提示词不能为空")
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
