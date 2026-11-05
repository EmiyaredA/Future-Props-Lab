"""Annotation-owned project links exported for Assets retention reconstruction."""

from typing import Literal

from pydantic import Field

from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier

PREFIX = "/v1/migration/annotation"
PINS_DATASET = "annotation.project-pins"
PINS_PATH = PREFIX + "/project-pins"


class AnnotationPin(HistoryRecord):
    id: Identifier
    revision: int = Field(ge=0)
    asset_ids: tuple[Identifier]


class AnnotationPinBatch(MigrationBatch[AnnotationPin]):
    dataset: Literal["annotation.project-pins"]
    records: tuple[AnnotationPin, ...] = Field(max_length=1)


AnnotationPinPage = MigrationPage[AnnotationPinBatch]
