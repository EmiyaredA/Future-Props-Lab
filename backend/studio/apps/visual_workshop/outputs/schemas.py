from typing import Literal

from pydantic import BaseModel, Field


class VisualNodeOutputOut(BaseModel):
    id: str
    node_id: str
    version: int
    kind: Literal["text", "image", "video", "audio"]
    asset_id: str | None
    inspection_asset_id: str | None = None
    text: str | None
    source: Literal["generated", "uploaded", "text", "legacy"]
    generation_task_id: str | None
    input_snapshot: list[dict]
    is_final: bool
    created_at: str


class VisualNodeOutputListOut(BaseModel):
    items: list[VisualNodeOutputOut]
    total: int


class VisualNodeOutputCreateIn(BaseModel):
    expected_revision: int = Field(ge=0)
    asset_id: str | None = None
    text: str | None = Field(default=None, max_length=20_000)


class VisualNodeFinalOutputIn(BaseModel):
    expected_revision: int = Field(ge=0)
    output_id: str
