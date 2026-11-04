"""Freeze one Visual batch for Models without importing the Visual application."""

from pydantic import UUID4, BaseModel, ConfigDict, Field, model_validator

from app.llm.schemas.generation_tasks import GenerationTaskCreateIn

from .library_assets import ID
from .motion_preview import FrameFile, sha256
from .visual_generation import (
    MAX_REFERENCES,
    PLANS,
    GenerationAssets,
    GenerationFileScope,
    VisualModelChoice,
)


def reference_ids(arguments):
    return {
        identity
        for field in ("reference_asset_ids", "audio_asset_ids", "video_asset_ids")
        for identity in getattr(arguments, field, ())
    } | {
        identity
        for field in ("reference_asset_id", "first_frame_asset_id", "last_frame_asset_id")
        if (identity := getattr(arguments, field, None))
    }


class TaskPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    task_id: UUID4
    arguments: GenerationTaskCreateIn
    explicit_fields: list[str] = Field(max_length=30)
    reference_titles: dict[str, str] = Field(max_length=MAX_REFERENCES)
    input_snapshot: list[dict] = Field(max_length=1000)

    @model_validator(mode="after")
    def exact_arguments(self):
        if self.arguments.canvas_node_id is not None or not set(self.explicit_fields).issubset(
            self.arguments.__class__.model_fields
        ):
            raise ValueError("生成请求不能包含画布写入参数")
        if not set(self.reference_titles).issubset(reference_ids(self.arguments)):
            raise ValueError("参考素材名称超出生成请求")
        return self


class GenerationPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    project_id: str = Field(pattern=rf"^{ID}$")
    plan_id: UUID4
    model: VisualModelChoice
    tasks: list[TaskPlan] = Field(min_length=1, max_length=9)
    assets: GenerationAssets

    @model_validator(mode="after")
    def exact_plan(self):
        first = self.tasks[0].arguments
        requested = reference_ids(first)
        if len(self.tasks) not in {1, 4, 9} or len({task.task_id for task in self.tasks}) != len(
            self.tasks
        ):
            raise ValueError("生成批次身份无效")
        if len(self.tasks) > 1 and first.kind != "image":
            raise ValueError("只有图片支持批量生成")
        if any(
            task.arguments.model_id != self.model.model_id
            or task.arguments.kind != first.kind
            or getattr(task.arguments, "mode", None) != getattr(first, "mode", None)
            or reference_ids(task.arguments) != requested
            for task in self.tasks
        ):
            raise ValueError("生成批次任务的模型和参考素材必须一致")
        if [asset.id for asset in self.assets.items] != sorted(requested):
            raise ValueError("生成素材元数据与参数不一致")
        return self

    @property
    def scope(self):
        return (
            GenerationFileScope(
                files=tuple(
                    FrameFile(id=asset.id, revision=asset.revision) for asset in self.assets.items
                )
            )
            if self.assets.items
            else None
        )

    @property
    def digest(self):
        return sha256(self.model_dump_json().encode())

    @property
    def path(self):
        return f"{PLANS}/{self.project_id}/{self.plan_id}/{self.digest}"
