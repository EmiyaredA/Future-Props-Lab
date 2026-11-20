"""Inputs and receipts for revision-bound design-card generation."""

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from studio.apps.visual_workshop.schemas.creative_workflow import Identifier, WorkflowModel


class CardGenerationIn(WorkflowModel):
    request_id: Identifier
    expected_revision: int = Field(ge=0)
    model_id: str
    prompt: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=6000)]
    size: Annotated[str, StringConstraints(min_length=1, max_length=32)]


class CardGenerationReceipt(BaseModel):
    task_id: str


class CardGenerationBinding(CardGenerationIn):
    card_id: Identifier
