from __future__ import annotations

from collections import deque
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.apps.visual_workshop.schemas.prompts import VisualPromptDraft
from app.capabilities.asset_store.schemas.files import (
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
from app.capabilities.asset_store.schemas.project_snapshots import ProjectSnapshotImportWarning
from app.llm.schemas.generation_tasks import (
    AudioGenerationTaskCreateIn,
    GenerationTaskCreateIn,
    GenerationTaskStatus,
    ImageGenerationTaskCreateIn,
    VideoGenerationTaskCreateIn,
)
from app.llm.schemas.video_capabilities import VideoCapabilitiesOut
from app.llm.schemas.workflow_video import WorkflowVideoCapabilitiesOut, WorkflowVideoParameters
from app.llm.task_execution import TaskExecutionInfo

__all__ = [
    "AudioGenerationTaskCreateIn",
    "GenerationTaskCreateIn",
    "GenerationTaskStatus",
    "ImageGenerationTaskCreateIn",
    "VideoGenerationTaskCreateIn",
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


def _clean_prompt_reference_names(value: dict[str, str]) -> dict[str, str]:
    cleaned: dict[str, str] = {}
    for asset_id, name in value.items():
        clean_id = asset_id.strip()
        clean_name = name.strip()
        if not clean_id or len(clean_id) > 128:
            raise ValueError("参考素材 ID 无效")
        if not clean_name or len(clean_name) > 255:
            raise ValueError("参考素材名称无效")
        cleaned[clean_id] = clean_name
    return cleaned


class VisualWorkshopProjectOut(BaseModel):
    is_official: bool = False
    id: str
    title: str
    kind: VisualWorkshopProjectKind
    status: VisualWorkshopProjectStatus
    revision: int
    created_at: str
    updated_at: str


class VisualWorkshopProjectListOut(BaseModel):
    items: list[VisualWorkshopProjectOut]


class VisualProjectSnapshotImportOut(BaseModel):
    project: VisualWorkshopProjectOut
    warnings: list[ProjectSnapshotImportWarning] = Field(default_factory=list)


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


class VisualCanvasImageGenerationDraft(VisualPromptDraft):
    model_id: str | None = None
    size: str = Field(default="1024x1024", min_length=1, max_length=32)
    seed: int | None = Field(default=None, ge=0)
    image_count: int = Field(default=1, ge=1, le=4)
    grid_size: Literal[1, 4, 9] | None = None
    grid_output: Literal["nodes", "composite"] | None = None
    reference_asset_id: str | None = None
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=14)
    prompt_reference_names: dict[str, str] = Field(default_factory=dict, max_length=16)

    @field_validator("prompt_reference_names")
    @classmethod
    def clean_prompt_reference_names(cls, value: dict[str, str]) -> dict[str, str]:
        return _clean_prompt_reference_names(value)


class VisualCanvasVideoGenerationDraft(VisualPromptDraft):
    model_id: str | None = None
    mode: Literal["text", "image", "frames", "reference"] = "text"
    duration: int = Field(default=5, ge=-1, le=30)
    resolution: Literal["480p", "720p", "1080p", "4k"] = "720p"
    ratio: Literal["16:9", "9:16", "4:3", "3:4", "1:1", "21:9", "adaptive"] = "16:9"
    watermark: bool = True
    generate_audio: bool = False
    first_frame_asset_id: str | None = None
    last_frame_asset_id: str | None = None
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=30)
    audio_asset_ids: list[str] = Field(default_factory=list, max_length=10)
    video_asset_ids: list[str] = Field(default_factory=list, max_length=10)
    workflow_parameters: WorkflowVideoParameters | None = None
    prompt_reference_names: dict[str, str] = Field(default_factory=dict, max_length=50)

    @field_validator("prompt_reference_names")
    @classmethod
    def clean_prompt_reference_names(cls, value: dict[str, str]) -> dict[str, str]:
        return _clean_prompt_reference_names(value)

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


class VisualCanvasAudioGenerationDraft(VisualPromptDraft):
    model_id: str | None = None
    mode: Literal["music", "sfx"] = "music"
    theme: str = Field(default="", max_length=500)
    style: str = Field(default="", max_length=500)
    duration: int | None = Field(default=None, ge=1, le=600)
    smart_duration: bool = True
    prompt_influence: float = Field(default=0.5, ge=0, le=1)
    output_format: Literal["mp3", "wav"] = "mp3"
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=3)

    @field_validator("reference_asset_ids")
    @classmethod
    def reference_assets_are_unique(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("音频参考素材不能重复")
        return values


class VisualCanvasNodeBase(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=120)
    position: VisualCanvasPosition
    category_id: str | None = None
    group: str | None = Field(default=None, max_length=120)
    tags: list[str] = Field(default_factory=list, max_length=20)
    approved: bool = Field(
        default_factory=bool,
        strict=True,
        description="人工确认节点当前结果已通过，省略时默认未通过",
    )
    output_sequence: int | None = Field(default=None, ge=0)
    final_output_id: str | None = None
    final_version: int | None = None

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
    generation_batch_id: str | None = None
    generation_draft: VisualCanvasImageGenerationDraft | None = None


class VisualCanvasVideoNode(VisualCanvasNodeBase):
    kind: Literal["video"]
    asset_id: str | None = None
    generation_task_id: str | None = None
    generation_draft: VisualCanvasVideoGenerationDraft | None = None


class VisualCanvasAudioNode(VisualCanvasNodeBase):
    kind: Literal["audio"]
    asset_id: str | None = None
    generation_task_id: str | None = None
    generation_draft: VisualCanvasAudioGenerationDraft | None = None


VisualCanvasNode = Annotated[
    VisualCanvasTextNode | VisualCanvasImageNode | VisualCanvasVideoNode | VisualCanvasAudioNode,
    Field(discriminator="kind"),
]


class VisualCanvasEdge(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    source_node_id: str = Field(min_length=1, max_length=64)
    target_node_id: str = Field(min_length=1, max_length=64)
    binding: Literal["final", "fixed"] = "final"
    output_id: str | None = None
    purpose: Literal["reference", "context", "first_frame", "last_frame"] = "reference"

    @model_validator(mode="after")
    def binding_is_complete(self) -> VisualCanvasEdge:
        if (self.binding == "fixed") != (self.output_id is not None):
            raise ValueError("固定引用必须指定输出版本，跟随引用不能指定版本")
        return self

    @field_validator("id", "source_node_id", "target_node_id")
    @classmethod
    def edge_strings_are_not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("连线标识和节点标识不能为空")
        return cleaned


def _validate_canvas_edges(nodes: list[VisualCanvasNode], edges: list[VisualCanvasEdge]) -> None:
    node_by_id = {node.id: node for node in nodes}
    edge_ids = [edge.id for edge in edges]
    if len(edge_ids) != len(set(edge_ids)):
        raise ValueError("画布连线 ID 不能重复")

    pairs: set[tuple[str, str]] = set()
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in node_by_id}
    for edge in edges:
        source = node_by_id.get(edge.source_node_id)
        target = node_by_id.get(edge.target_node_id)
        if source is None or target is None:
            raise ValueError("连线引用的节点不存在")
        if source.id == target.id:
            raise ValueError("节点不能连接到自身")
        pair = (source.id, target.id)
        if pair in pairs:
            raise ValueError("相同节点之间不能重复连线")
        pairs.add(pair)
        if target.kind == "text" and source.kind != "text":
            raise ValueError("文本节点只能接收文本上下文")
        if target.kind == "image" and source.kind not in {"image", "text"}:
            raise ValueError("图片节点只能接收图片素材")
        if target.kind == "audio":
            if source.kind not in {"audio", "text"}:
                raise ValueError("音频节点只能接收音频素材")
            if (
                source.kind != "text"
                and target.generation_draft
                and target.generation_draft.mode == "sfx"
            ):
                raise ValueError("音效生成不接收上游素材")
        outgoing[source.id].append(target.id)

    # Iterative topological traversal also handles a maximum-size dependency chain.
    incoming = {node_id: 0 for node_id in node_by_id}
    for targets in outgoing.values():
        for target_id in targets:
            incoming[target_id] += 1
    ready = deque(node_id for node_id, count in incoming.items() if count == 0)
    visited = 0
    while ready:
        node_id = ready.popleft()
        visited += 1
        for target_id in outgoing[node_id]:
            incoming[target_id] -= 1
            if incoming[target_id] == 0:
                ready.append(target_id)
    if visited != len(node_by_id):
        raise ValueError("画布连线不能形成依赖环")


class VisualMaterialCategory(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    groups: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("groups")
    @classmethod
    def valid_groups(cls, groups: list[str]) -> list[str]:
        if any(not group.strip() or len(group) > 120 for group in groups) or len(groups) != len(
            set(groups)
        ):
            raise ValueError("分组名称必须为 1–120 个字符且不能重复")
        return groups


def default_material_categories() -> list[VisualMaterialCategory]:
    return [
        VisualMaterialCategory(id=key, name=name)
        for key, name in (("character", "人设"), ("scene", "场景"), ("storyboard", "分镜"))
    ]


class VisualCanvasDocumentPutIn(BaseModel):
    expected_revision: int = Field(ge=0)
    nodes: list[VisualCanvasNode] = Field(max_length=1000)
    edges: list[VisualCanvasEdge] = Field(default_factory=list, max_length=2000)
    categories: list[VisualMaterialCategory] | None = Field(default=None, max_length=100)

    @field_validator("nodes")
    @classmethod
    def node_ids_are_unique(cls, nodes: list[VisualCanvasNode]) -> list[VisualCanvasNode]:
        ids = [node.id for node in nodes]
        if len(ids) != len(set(ids)):
            raise ValueError("画布节点 ID 不能重复")
        return nodes

    @model_validator(mode="after")
    def graph_is_valid(self) -> VisualCanvasDocumentPutIn:
        _validate_canvas_edges(self.nodes, self.edges)
        if self.categories is not None:
            ids = [category.id for category in self.categories]
            if len(ids) != len(set(ids)):
                raise ValueError("分类 ID 不能重复")
            if any(node.category_id and node.category_id not in ids for node in self.nodes):
                raise ValueError("节点分类不存在")
        return self


class VisualCanvasDocumentOut(BaseModel):
    project_id: str
    nodes: list[VisualCanvasNode]
    edges: list[VisualCanvasEdge]
    revision: int
    updated_at: str
    categories: list[VisualMaterialCategory] = Field(default_factory=default_material_categories)


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


class GenerationModelOptionOut(BaseModel):
    id: str
    provider_id: str
    provider_name: str
    kind: Literal["image", "video", "audio"]
    slug: str
    label: str
    description: str
    sizes: list[str] = Field(default_factory=list)
    max_reference_images: int = 1
    supports_seed: bool | None = True
    max_prompt_length: int | None = 2000
    video_capabilities: VideoCapabilitiesOut | None = None
    workflow_capabilities: WorkflowVideoCapabilitiesOut | None = None
    reference_mime_types: list[str] = Field(
        default_factory=lambda: ["image/jpeg", "image/png", "image/webp"]
    )


class GenerationOptionsOut(BaseModel):
    models: list[GenerationModelOptionOut]


class GenerationTaskOut(BaseModel):
    id: str
    project_id: str
    provider_id: str | None
    model_id: str | None
    provider_kind: Literal[
        "volcengine_image",
        "senseaudio_image",
        "volcengine_video",
        "senseaudio_video",
        "zealman_video",
        "senseaudio_music",
        "senseaudio_sfx",
    ]
    kind: Literal["image", "video", "audio"]
    provider_name: str
    model_slug: str
    request_payload: dict
    canvas_node_id: str | None
    provider_task_id: str | None
    status: GenerationTaskStatus
    progress: int
    execution_info: TaskExecutionInfo | None = None
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
