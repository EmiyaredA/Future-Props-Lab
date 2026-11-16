"""Apply owner-specific editing rules through an atomic, replaceable storage port."""

from typing import Protocol

from studio.apps.visual_workshop.operation_values import transform
from studio.apps.visual_workshop.schemas.operations import VisualOperationsIn
from studio.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
    VisualCanvasDocumentPutIn,
)
from studio.runtime.revisioned_commands import apply_revisioned_command


class DocumentEdits(Protocol):
    async def load(self, resource: str) -> VisualCanvasDocumentOut: ...
    async def replay(
        self, resource: str, command: VisualOperationsIn
    ) -> VisualCanvasDocumentOut | None: ...
    async def commit(
        self, resource: str, command: VisualOperationsIn, candidate: VisualCanvasDocumentPutIn
    ) -> VisualCanvasDocumentOut: ...


async def apply_operations(
    store: DocumentEdits, project_id: str, body: VisualOperationsIn
) -> VisualCanvasDocumentOut:
    return await apply_revisioned_command(
        store,
        project_id,
        body,
        transform=transform,
        describe=lambda snapshot: snapshot.model_dump(mode="json"),
    )
