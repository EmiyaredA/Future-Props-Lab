"""The original Story and snapshot pins transferred to Assets after file verification."""

from typing import Literal

from pydantic import Field, field_validator

from studio.contracts.asset_library.references import ReferenceUpdate
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier

PINS_DATASET = "galgame.story-pins"
PINS_PATH = "/v1/migration/galgame/story-pins"


class StoryPins(HistoryRecord):
    id: Identifier
    revision: int = Field(ge=0, strict=True)
    asset_ids: list[str] = Field(max_length=10000)

    @field_validator("asset_ids")
    @classmethod
    def canonical_assets(cls, values):
        return ReferenceUpdate.canonical_assets(values)


class StoryPinBatch(MigrationBatch[StoryPins]):
    dataset: Literal["galgame.story-pins"]
    records: tuple[StoryPins, ...] = Field(max_length=1)


StoryPinPage = MigrationPage[StoryPinBatch]
