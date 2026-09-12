from typing import Literal

from pydantic import Field

from app.schemas.project_operations import EntityOperation, OperationBatch


class VisualEntityOperation(EntityOperation):
    entity: Literal["node", "edge"]


class VisualOperationsIn(OperationBatch):
    operations: list[VisualEntityOperation] = Field(min_length=1, max_length=1000)
