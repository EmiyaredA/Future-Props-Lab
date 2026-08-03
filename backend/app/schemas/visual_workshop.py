from __future__ import annotations

import ipaddress
from typing import Annotated, Literal

from pydantic import BaseModel, Field, HttpUrl, TypeAdapter, field_validator, model_validator

VisualWorkshopProjectKind = Literal["image", "video", "canvas"]
VisualWorkshopProjectStatus = Literal["draft", "completed"]
VisualAssetScope = Literal["library", "project"]
VisualAssetKind = Literal["image", "video", "audio", "document"]
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


class VisualCanvasVideoNode(VisualCanvasNodeBase):
    kind: Literal["video"]
    asset_id: str | None = None
    generation_task_id: str | None = None


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


class VisualAssetFolderOut(BaseModel):
    id: str
    project_id: str | None
    parent_id: str | None
    name: str
    revision: int
    created_at: str
    updated_at: str


class VisualAssetFolderListOut(BaseModel):
    items: list[VisualAssetFolderOut]


class VisualAssetFolderCreateIn(BaseModel):
    scope: VisualAssetScope
    project_id: str | None = None
    parent_id: str | None = None
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str) -> str:
        return _clean_title(value)


class VisualAssetFolderPatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: str | None = None
    move_to_root: bool = False

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str | None) -> str | None:
        return _clean_title(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self) -> VisualAssetFolderPatchIn:
        if self.name is None and self.parent_id is None and not self.move_to_root:
            raise ValueError("至少需要提供一个修改字段")
        if self.parent_id is not None and self.move_to_root:
            raise ValueError("parent_id 与 move_to_root 不能同时提供")
        return self


class VisualAssetOut(BaseModel):
    id: str
    project_id: str | None
    folder_id: str | None
    original_filename: str
    display_name: str
    media_kind: VisualAssetKind
    mime_type: str
    byte_size: int
    revision: int
    created_at: str
    updated_at: str
    source: Literal["library", "project"]
    is_reference: bool = False
    reference_id: str | None = None


class VisualAssetListOut(BaseModel):
    items: list[VisualAssetOut]


class VisualAssetPatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    folder_id: str | None = None
    move_to_root: bool = False

    @field_validator("display_name")
    @classmethod
    def display_name_is_not_blank(cls, value: str | None) -> str | None:
        return _clean_title(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self) -> VisualAssetPatchIn:
        if self.display_name is None and self.folder_id is None and not self.move_to_root:
            raise ValueError("至少需要提供一个修改字段")
        if self.folder_id is not None and self.move_to_root:
            raise ValueError("folder_id 与 move_to_root 不能同时提供")
        return self


class VisualAssetReferenceCreateIn(BaseModel):
    asset_id: str
    folder_id: str | None = None


class VisualAssetReferencePatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    folder_id: str | None = None
    move_to_root: bool = False

    @field_validator("display_name")
    @classmethod
    def display_name_is_not_blank(cls, value: str | None) -> str | None:
        return _clean_title(value) if value is not None else None

    @model_validator(mode="after")
    def has_change(self) -> VisualAssetReferencePatchIn:
        if self.display_name is None and self.folder_id is None and not self.move_to_root:
            raise ValueError("至少需要提供一个修改字段")
        if self.folder_id is not None and self.move_to_root:
            raise ValueError("folder_id 与 move_to_root 不能同时提供")
        return self


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

    @field_validator("prompt")
    @classmethod
    def prompt_is_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("提示词不能为空")
        return cleaned


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
    audio_urls: list[str] = Field(default_factory=list, max_length=3)
    video_urls: list[str] = Field(default_factory=list, max_length=3)

    @field_validator("prompt")
    @classmethod
    def clean_prompt(cls, value: str) -> str:
        return value.strip()

    @field_validator("audio_urls", "video_urls")
    @classmethod
    def https_urls(cls, values: list[str]) -> list[str]:
        result: list[str] = []
        for value in values:
            parsed = TypeAdapter(HttpUrl).validate_python(value.strip())
            if parsed.scheme != "https":
                raise ValueError("参考音频和视频必须使用 HTTPS 地址")
            hostname = (parsed.host or "").rstrip(".").lower()
            if hostname == "localhost" or hostname.endswith((".local", ".internal")):
                raise ValueError("参考音频和视频必须使用公网 HTTPS 地址")
            try:
                address = ipaddress.ip_address(hostname)
            except ValueError:
                pass
            else:
                if not address.is_global:
                    raise ValueError("参考音频和视频必须使用公网 HTTPS 地址")
            result.append(str(parsed))
        return result

    @model_validator(mode="after")
    def valid_content_mode(self) -> VideoGenerationTaskCreateIn:
        if self.mode == "text":
            if not self.prompt:
                raise ValueError("纯文本模式必须填写提示词")
            if any(
                (
                    self.first_frame_asset_id,
                    self.last_frame_asset_id,
                    self.reference_asset_ids,
                    self.audio_urls,
                    self.video_urls,
                )
            ):
                raise ValueError("纯文本模式不能携带参考素材")
        elif self.mode == "frames":
            if not self.first_frame_asset_id:
                raise ValueError("首尾帧模式必须选择首帧")
            if self.reference_asset_ids or self.audio_urls or self.video_urls:
                raise ValueError("首尾帧模式不能与参考素材模式混用")
        else:
            if self.first_frame_asset_id or self.last_frame_asset_id:
                raise ValueError("参考素材模式不能携带首尾帧")
            if not self.reference_asset_ids and not self.video_urls:
                raise ValueError("参考素材模式至少需要图片或视频")
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
