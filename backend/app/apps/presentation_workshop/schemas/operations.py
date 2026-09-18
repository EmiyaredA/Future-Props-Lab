from typing import Literal

from pydantic import Field

from app.runtime.operation_batches import EntityOperation, OperationBatch


class PresentationEntityOperation(EntityOperation):
    entity: Literal["slide", "element"]


class PresentationOperationsIn(OperationBatch):
    operations: list[PresentationEntityOperation] = Field(min_length=1, max_length=1000)
