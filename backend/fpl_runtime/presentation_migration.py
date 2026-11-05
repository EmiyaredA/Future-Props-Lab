"""Presentation source projections exchanged between two maintenance owners."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .asset_references import ReferenceUpdate
from .migration_batches import MigrationBatch, MigrationPage

ID = r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$"
REFERENCE_DATASETS = {
    "presentation.project-references": "project",
    "presentation.template-references": "template",
    "presentation.example-references": "example",
}


class Projection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=ID)
    revision: int = Field(ge=0)
    asset_ids: list[str] = Field(max_length=10000)

    @field_validator("asset_ids")
    @classmethod
    def canonical_assets(cls, values):
        return ReferenceUpdate.canonical_assets(values)


class ProjectionBatch(MigrationBatch[Projection]):
    dataset: Literal[
        "presentation.project-references",
        "presentation.template-references",
        "presentation.example-references",
    ]
    records: tuple[Projection, ...] = Field(max_length=1)


ProjectionPage = MigrationPage[ProjectionBatch]
