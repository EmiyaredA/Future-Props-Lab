from typing import Literal

from pydantic import Field

from app.runtime.operation_batches import EntityOperation, OperationBatch


class GalgameEntityOperation(EntityOperation):
    chapter_id: str | None = None
    entity: Literal["character", "scene", "cg", "variable", "asset", "chapter", "fragment", "block"]


class GalgameOperationsIn(OperationBatch):
    operations: list[GalgameEntityOperation] = Field(min_length=1, max_length=1000)
    settings: dict = Field(default_factory=dict)
