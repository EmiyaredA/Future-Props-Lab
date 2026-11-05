"""The retained Canvas files exchanged with Assets during Visual history transfer."""

from typing import Literal

from pydantic import Field, field_validator

from studio.contracts.asset_library.references import ReferenceUpdate
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier

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


CONVERSATION_PINS_DATASET = "visual.conversation-pins"
CONVERSATION_PINS_PATH = "/v1/migration/visual/conversation-pins"


class ConversationPins(CanvasPins):
    project_id: Identifier


class ConversationPinBatch(MigrationBatch[ConversationPins]):
    dataset: Literal["visual.conversation-pins"]
    records: tuple[ConversationPins, ...] = Field(max_length=1)


ConversationPinPage = MigrationPage[ConversationPinBatch]


ACCEPTANCE_PINS_DATASET = "visual.acceptance-pins"
ACCEPTANCE_PINS_PATH = "/v1/migration/visual/acceptance-pins"


class AcceptancePinBatch(MigrationBatch[CanvasPins]):
    dataset: Literal["visual.acceptance-pins"]
    records: tuple[CanvasPins, ...] = Field(max_length=1)


AcceptancePinPage = MigrationPage[AcceptancePinBatch]
