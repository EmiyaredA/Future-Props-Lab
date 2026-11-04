"""The retained Canvas files exchanged with Assets during Visual history transfer."""

from typing import Literal

from pydantic import Field, field_validator

from .asset_references import ReferenceUpdate
from .migration_batches import MigrationBatch, MigrationPage
from .project_history_records import HistoryRecord, Identifier

CANVAS_PINS_DATASET = "visual.canvas-pins"
CANVAS_PINS_PATH = "/v1/migration/visual/canvas-pins"


class CanvasPins(HistoryRecord):
    id: Identifier
    revision: int = Field(ge=0, strict=True)
    asset_ids: list[str] = Field(max_length=10000)

    @field_validator("asset_ids")
    @classmethod
    def canonical_assets(cls, values):
        return ReferenceUpdate.canonical_assets(values)


class CanvasPinBatch(MigrationBatch[CanvasPins]):
    dataset: Literal["visual.canvas-pins"]
    records: tuple[CanvasPins, ...] = Field(max_length=1)


CanvasPinPage = MigrationPage[CanvasPinBatch]
