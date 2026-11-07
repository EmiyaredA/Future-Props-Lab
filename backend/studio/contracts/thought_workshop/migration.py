"""Contract for rebuilding Thought-owned reference sets in Assets."""

from typing import Literal

from pydantic import Field

from studio.contracts.asset_library.descriptions import ID
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier

PIN_KINDS = {
    "thought.knowledge-base-pins": "knowledge-base",
    "thought.note-pins": "note",
    "thought.template-pins": "template",
    "thought.publication-pins": "publication",
}
PIN_CURSOR = rf"^{ID}$"


def pin_path(dataset):
    return "/v1/migration/thought/" + dataset.split(".")[1]


class ThoughtPins(HistoryRecord):
    id: Identifier
    revision: int = Field(ge=0, strict=True)
    asset_ids: list[str] = Field(max_length=10_000)


class ThoughtPinBatch(MigrationBatch[ThoughtPins]):
    dataset: Literal[
        "thought.knowledge-base-pins",
        "thought.note-pins",
        "thought.template-pins",
        "thought.publication-pins",
    ]
    records: tuple[ThoughtPins, ...] = Field(max_length=1)


ThoughtPinPage = MigrationPage[ThoughtPinBatch]
