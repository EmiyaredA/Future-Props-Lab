from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.project_operations import EntityOperation, OperationBatch, OperationId


class AnnotationEntityOperation(EntityOperation):
    action: Literal["insert", "update", "remove", "move", "duplicate"]
    entity: Literal["speaker", "segment"]


class AnnotationSplitOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["split"]
    id: OperationId
    new_id: OperationId
    at_ms: int = Field(ge=100)


class AnnotationMergeOperation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["merge_next"]
    id: OperationId


AnnotationOperation = Annotated[
    AnnotationEntityOperation | AnnotationSplitOperation | AnnotationMergeOperation,
    Field(discriminator="action"),
]


class AnnotationOperationsIn(OperationBatch):
    operations: list[AnnotationOperation] = Field(min_length=1, max_length=1000)


class SavedSegmentTranscriptionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    model_id: str
    language: str | None = None
    target_language: str | None = None
