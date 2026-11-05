"""Shared transport shapes; allowed entities and business semantics belong to each workshop."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

OperationId = Annotated[str, Field(min_length=1, max_length=64)]


class EntityOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["insert", "update", "remove", "move", "duplicate"]
    id: OperationId
    parent_id: OperationId | None = None
    index: int | None = Field(default=None, ge=0)
    value: dict[str, Any] = Field(default_factory=dict)


class OperationBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    request_id: OperationId
