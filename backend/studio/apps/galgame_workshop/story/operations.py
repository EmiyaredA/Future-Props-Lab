"""Apply owner-specific editing rules through an atomic, replaceable storage port."""

from typing import Protocol

from studio.apps.galgame_workshop.schemas import GalgameStoryDocumentOut, GalgameStoryDocumentPutIn
from studio.apps.galgame_workshop.schemas.operations import GalgameOperationsIn
from studio.apps.galgame_workshop.story.operation_values import transform
from studio.runtime.revisioned_commands import apply_revisioned_command


class DocumentEdits(Protocol):
    async def load(self, resource: str) -> GalgameStoryDocumentOut: ...
    async def replay(
        self, resource: str, command: GalgameOperationsIn
    ) -> GalgameStoryDocumentOut | None: ...
    async def commit(
        self, resource: str, command: GalgameOperationsIn, candidate: GalgameStoryDocumentPutIn
    ) -> GalgameStoryDocumentOut: ...


async def apply_operations(
    store: DocumentEdits, project_id: str, body: GalgameOperationsIn
) -> GalgameStoryDocumentOut:
    return await apply_revisioned_command(
        store,
        project_id,
        body,
        transform=transform,
        describe=lambda snapshot: snapshot.model_dump(mode="json"),
    )
