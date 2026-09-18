from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.apps.visual_workshop.schemas.workshop import VisualCanvasPosition


class ImageCompositionItemIn(BaseModel):
    node_id: str = Field(min_length=1, max_length=64)
    asset_id: str = Field(min_length=1, max_length=36)
    caption: str = Field(default="", max_length=120)

    @field_validator("caption")
    @classmethod
    def clean_caption(cls, value: str) -> str:
        return value.strip()


class ImageCompositionCreateIn(BaseModel):
    grid_size: Literal[4, 9]
    items: list[ImageCompositionItemIn]
    expected_canvas_revision: int = Field(ge=0)
    result_position: VisualCanvasPosition
    title: str = Field(default="", max_length=120)

    @model_validator(mode="after")
    def items_match_grid_size(self) -> ImageCompositionCreateIn:
        if len(self.items) != self.grid_size:
            raise ValueError(f"{self.grid_size} 宫格必须提供 {self.grid_size} 个图片节点")
        node_ids = [item.node_id for item in self.items]
        asset_ids = [item.asset_id for item in self.items]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("图片节点不能重复")
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("图片素材不能重复")
        return self


class ImageGenerationBatchCreateIn(BaseModel):
    model_id: str
    prompt: str = Field(min_length=1, max_length=6000)
    size: str = Field(default="1024x1024", max_length=32)
    seed: int | None = Field(default=None, ge=0)
    reference_asset_id: str | None = None
    grid_size: Literal[4, 9]
    grid_output: Literal["nodes", "composite"] = "nodes"
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
    def canvas_link_is_complete(self) -> ImageGenerationBatchCreateIn:
        if (self.canvas_node_id is None) != (self.expected_canvas_revision is None):
            raise ValueError("画布节点和画布版本必须同时提供")
        return self


class GenerationBatchOut(BaseModel):
    id: str
    project_id: str
    batch_kind: Literal["generation", "composition"]
    grid_size: Literal[4, 9]
    grid_output: Literal["nodes", "composite"]
    child_task_ids: list[str]
    status: Literal["queued", "processing", "completed", "failed"]
    completed_count: int
    failed_count: int
    result_asset_id: str | None
    error_message: str | None
    generation_node_id: str | None
    revision: int
    created_at: str
    updated_at: str
    completed_at: str | None


class GenerationBatchListOut(BaseModel):
    items: list[GenerationBatchOut]
    total: int
