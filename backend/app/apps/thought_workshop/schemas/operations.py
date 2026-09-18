from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.runtime.operation_batches import OperationBatch


class ThoughtContentOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["insert", "replace", "remove", "move", "replace_text", "set_marks", "set_attrs"]
    path: list[int] = Field(min_length=1, max_length=32)
    value: dict = Field(default_factory=dict)
    target_index: int | None = Field(default=None, ge=0)
    start: int = Field(default=0, ge=0)
    end: int | None = Field(default=None, ge=0)
    text: str = Field(default="", max_length=20000)
    marks: list[dict] = Field(default_factory=list)


class ThoughtOperationsIn(OperationBatch):
    operations: list[ThoughtContentOperation] = Field(min_length=1, max_length=1000)
