from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.files import (
    VisualAssetFolderCreateIn,
    VisualAssetFolderListOut,
    VisualAssetFolderOut,
    VisualAssetFolderPatchIn,
    VisualAssetListOut,
    VisualAssetOut,
    VisualAssetPatchIn,
    VisualAssetReferenceCreateIn,
    VisualAssetReferencePatchIn,
)

__all__ = [
    "VisualAssetFolderCreateIn",
    "VisualAssetFolderListOut",
    "VisualAssetFolderOut",
    "VisualAssetFolderPatchIn",
    "VisualAssetListOut",
    "VisualAssetOut",
    "VisualAssetPatchIn",
    "VisualAssetReferenceCreateIn",
    "VisualAssetReferencePatchIn",
]

VisualWorkshopProjectKind = Literal["image", "video", "canvas"]
VisualWorkshopProjectStatus = Literal["draft", "completed"]
VisualCanvasNodeKind = Literal["text", "image", "video", "audio"]


def _clean_title(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("项目名称不能为空")
    return cleaned


class VisualWorkshopProjectOut(BaseModel):
    id: str
    title: str
    kind: VisualWorkshopProjectKind
    status: VisualWorkshopProjectStatus
    revision: int
    created_at: str
    updated_at: str


class VisualWorkshopProjectListOut(BaseModel):
    items: list[VisualWorkshopProjectOut]


class VisualWorkshopProjectCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    kind: VisualWorkshopProjectKind

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class VisualWorkshopProjectPatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    kind: VisualWorkshopProjectKind | None = None
    status: VisualWorkshopProjectStatus | None = None

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str | None) -> str | None:
        return _clean_title(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self) -> VisualWorkshopProjectPatchIn:
        if self.title is None and self.kind is None and self.status is None:
            raise ValueError("至少需要提供一个修改字段")
        return self


class VisualCanvasPosition(BaseModel):
    x: float = Field(ge=-1_000_000, le=1_000_000)
    y: float = Field(ge=-1_000_000, le=1_000_000)


class VisualCanvasImageGenerationDraft(BaseModel):
    model_id: str | None = None
    prompt: str = Field(default="", max_length=6000)
    size: str = Field(default="1024x1024", min_length=1, max_length=32)
    seed: int | None = Field(default=None, ge=0)
    image_count: int = Field(default=1, ge=1, le=4)
    reference_asset_id: str | None = None


class VisualCanvasVideoGenerationDraft(BaseModel):
    model_id: str | None = None
    prompt: str = Field(default="", max_length=6000)
    mode: Literal["text", "image", "frames", "reference"] = "text"
    duration: int = Field(default=5, ge=4, le=15)
    resolution: Literal["480p", "720p", "1080p"] = "720p"
    ratio: Literal["16:9", "9:16", "4:3", "3:4", "1:1"] = "16:9"
    watermark: bool = True
    generate_audio: bool = False
    first_frame_asset_id: str | None = None
    last_frame_asset_id: str | None = None
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=9)
    audio_asset_ids: list[str] = Field(default_factory=list, max_length=3)
    video_asset_ids: list[str] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def references_are_unique(self) -> VisualCanvasVideoGenerationDraft:
        for values in (
            self.reference_asset_ids,
            self.audio_asset_ids,
            self.video_asset_ids,
        ):
            if len(values) != len(set(values)):
                raise ValueError("同类参考素材不能重复")
        if (
            self.first_frame_asset_id is not None
            and self.first_frame_asset_id == self.last_frame_asset_id
        ):
            raise ValueError("首帧和尾帧不能使用同一素材")
        return self


class VisualCanvasNodeBase(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=120)
    position: VisualCanvasPosition

    @field_validator("id", "title")
    @classmethod
    def node_strings_are_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("节点标识和标题不能为空")
        return cleaned


class VisualCanvasTextNode(VisualCanvasNodeBase):
    kind: Literal["text"]
    text: str = Field(default="", max_length=20_000)


class VisualCanvasImageNode(VisualCanvasNodeBase):
    kind: Literal["image"]
    asset_id: str | None = None
    generation_task_id: str | None = None
    generation_draft: VisualCanvasImageGenerationDraft | None = None


class VisualCanvasVideoNode(VisualCanvasNodeBase):
    kind: Literal["video"]
    asset_id: str | None = None
    generation_task_id: str | None = None
    generation_draft: VisualCanvasVideoGenerationDraft | None = None


class VisualCanvasAudioNode(VisualCanvasNodeBase):
    kind: Literal["audio"]
    asset_id: str | None = None


VisualCanvasNode = Annotated[
    VisualCanvasTextNode | VisualCanvasImageNode | VisualCanvasVideoNode | VisualCanvasAudioNode,
    Field(discriminator="kind"),
]


class VisualCanvasDocumentPutIn(BaseModel):
    expected_revision: int = Field(ge=0)
    nodes: list[VisualCanvasNode] = Field(default_factory=list, max_length=500)

    @field_validator("nodes")
    @classmethod
    def node_ids_are_unique(cls, nodes: list[VisualCanvasNode]) -> list[VisualCanvasNode]:
        ids = [node.id for node in nodes]
        if len(ids) != len(set(ids)):
            raise ValueError("画布节点 ID 不能重复")
        return nodes


class VisualCanvasDocumentOut(BaseModel):
    project_id: str
    nodes: list[VisualCanvasNode]
    revision: int
    updated_at: str


VisualAssistantMessageStatus = Literal["pending", "completed", "error", "cancelled"]
VisualAssistantActionStatus = Literal[
    "proposed",
    "waiting_approval",
    "running",
    "completed",
    "rejected",
    "failed",
    "cancelled",
]


class VisualAssistantAssetOut(BaseModel):
    id: str
    display_name: str
    mime_type: str
    byte_size: int


class VisualAssistantTextPart(BaseModel):
    type: Literal["text"]
    text: str = Field(max_length=100_000)


class VisualAssistantAssetPart(BaseModel):
    type: Literal["asset"]
    asset_id: str = Field(min_length=1, max_length=64)


VisualAssistantContentPart = Annotated[
    VisualAssistantTextPart | VisualAssistantAssetPart,
    Field(discriminator="type"),
]


class VisualAssistantActionOut(BaseModel):
    id: str
    action_id: str
    run_id: str
    approval_group_id: str | None
    position: int
    tool_name: str
    effect: Literal["read", "write", "external"]
    status: VisualAssistantActionStatus
    display_payload: dict
    result_payload: dict
    error_message: str | None
    duration_ms: int | None
    canvas_revision: int | None
    generation_task_id: str | None
    created_at: str
    updated_at: str


class VisualAssistantMessageOut(BaseModel):
    id: str
    turn_id: str
    role: Literal["user", "assistant"]
    content: str
    model_slug: str
    status: VisualAssistantMessageStatus
    error_message: str | None
    created_at: str
    content_parts: list[VisualAssistantContentPart] = Field(default_factory=list)
    assets: list[VisualAssistantAssetOut] = Field(default_factory=list)
    actions: list[VisualAssistantActionOut] = Field(default_factory=list)


class VisualAssistantConversationSummaryOut(BaseModel):
    id: str
    project_id: str
    title: str
    model_id: str | None
    model_slug: str
    image_model_id: str | None
    image_model_slug: str
    video_model_id: str | None
    video_model_slug: str
    revision: int
    created_at: str
    updated_at: str


class VisualAssistantConversationOut(VisualAssistantConversationSummaryOut):
    messages: list[VisualAssistantMessageOut] = Field(default_factory=list)


class VisualAssistantConversationListOut(BaseModel):
    items: list[VisualAssistantConversationSummaryOut]


class VisualAssistantModelOptionOut(BaseModel):
    id: str
    provider_id: str
    provider_name: str
    slug: str
    label: str
    description: str
    capabilities: list[str]


class VisualAssistantModelOptionListOut(BaseModel):
    items: list[VisualAssistantModelOptionOut]


class VisualAssistantConversationPatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    model_id: str | None = None
    image_model_id: str | None = None
    video_model_id: str | None = None

    @field_validator("title")
    @classmethod
    def title_is_not_blank(cls, value: str | None) -> str | None:
        return _clean_title(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self) -> VisualAssistantConversationPatchIn:
        model_fields = {"model_id", "image_model_id", "video_model_id"}
        if self.title is None and not model_fields.intersection(self.model_fields_set):
            raise ValueError("至少需要提供标题或模型")
        return self


class VisualAssistantSendIn(BaseModel):
    expected_revision: int = Field(ge=0)
    canvas_revision: int = Field(ge=0)
    content: str = Field(default="", max_length=100_000)
    asset_ids: list[str] = Field(default_factory=list, max_length=5)
    content_parts: list[VisualAssistantContentPart] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def has_content(self) -> VisualAssistantSendIn:
        self.content = self.content.strip()
        if self.content_parts:
            if self.content or self.asset_ids:
                raise ValueError("结构化正文不能与旧版正文或附件字段混用")
            text_length = sum(
                len(part.text)
                for part in self.content_parts
                if isinstance(part, VisualAssistantTextPart)
            )
            if text_length > 100_000:
                raise ValueError("消息文本不能超过 100000 个字符")
            asset_ids = {
                part.asset_id
                for part in self.content_parts
                if isinstance(part, VisualAssistantAssetPart)
            }
            if len(asset_ids) > 5:
                raise ValueError("每条消息最多添加 5 个附件")
            if not asset_ids and not any(
                isinstance(part, VisualAssistantTextPart) and part.text.strip()
                for part in self.content_parts
            ):
                raise ValueError("消息文本和附件不能同时为空")
            return self
        if not self.content and not self.asset_ids:
            raise ValueError("消息文本和附件不能同时为空")
        if len(set(self.asset_ids)) != len(self.asset_ids):
            raise ValueError("附件不能重复")
        return self


class VisualAssistantApprovalIn(BaseModel):
    decision: Literal["approve", "reject"]
    canvas_revision: int = Field(ge=0)


class VisualAssistantApprovalOut(BaseModel):
    accepted: bool = True


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
        if (self.canvas_node_id is None) != (self.expected_canvas_revision is None):
            raise ValueError("画布节点和画布版本必须同时提供")
        return self


class VideoGenerationTaskCreateIn(BaseModel):
    kind: Literal["video"]
    model_id: str
    prompt: str = Field(default="", max_length=6000)
    mode: Literal["text", "frames", "reference"] = "text"
    duration: int = Field(default=5, ge=4, le=15)
    resolution: Literal["480p", "720p", "1080p"] = "720p"
    ratio: Literal["16:9", "9:16", "4:3", "3:4", "1:1"] = "16:9"
    watermark: bool = True
    generate_audio: bool = False
    first_frame_asset_id: str | None = None
    last_frame_asset_id: str | None = None
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=9)
    audio_asset_ids: list[str] = Field(default_factory=list, max_length=3)
    video_asset_ids: list[str] = Field(default_factory=list, max_length=3)
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
            if not self.reference_asset_ids and not self.video_asset_ids:
                raise ValueError("参考素材模式至少需要图片或视频")
            if self.audio_asset_ids and not (self.reference_asset_ids or self.video_asset_ids):
                raise ValueError("参考音频必须搭配参考图片或视频")
        return self


GenerationTaskCreateIn = Annotated[
    ImageGenerationTaskCreateIn | VideoGenerationTaskCreateIn,
    Field(discriminator="kind"),
]


class GenerationModelOptionOut(BaseModel):
    id: str
    provider_id: str
    provider_name: str
    kind: Literal["image", "video"]
    slug: str
    label: str
    description: str
    sizes: list[str] = Field(default_factory=list)


class GenerationOptionsOut(BaseModel):
    models: list[GenerationModelOptionOut]


class GenerationTaskOut(BaseModel):
    id: str
    project_id: str
    provider_id: str | None
    model_id: str | None
    provider_kind: Literal["senseaudio_image", "senseaudio_video"]
    kind: Literal["image", "video"]
    provider_name: str
    model_slug: str
    request_payload: dict
    provider_task_id: str | None
    status: GenerationTaskStatus
    progress: int
    error_message: str | None
    result_asset_id: str | None
    can_retry_materialization: bool
    revision: int
    created_at: str
    updated_at: str
    completed_at: str | None


class GenerationTaskListOut(BaseModel):
    items: list[GenerationTaskOut]
    total: int
