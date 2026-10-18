from typing import Literal

from pydantic import Field

from app.apps.presentation_workshop.schemas.document import PresentationSlide
from app.runtime.operation_batches import EntityOperation, OperationBatch


class PresentationFragment(PresentationSlide):
    """Native fragment rooted at id; reference and archived slide image must be empty."""

    background: str = "#FFFFFF"
    notes: str = ""


class PresentationEntityOperation(EntityOperation):
    entity: Literal["slide", "element", "group", "connection", "infographic", "fragment"]
    fragment: PresentationFragment | None = None


class PresentationOperationsIn(OperationBatch):
    operations: list[PresentationEntityOperation] = Field(min_length=1, max_length=1000)
