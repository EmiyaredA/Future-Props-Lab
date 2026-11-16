"""Apply an idempotent document command through an atomic storage port."""

from typing import Protocol

from studio.apps.audio_annotation.rules.editing import transform
from studio.apps.audio_annotation.schemas.document import (
    AudioAnnotationDocumentOut,
    AudioAnnotationDocumentPutIn,
)
from studio.apps.audio_annotation.schemas.operations import AnnotationOperationsIn
from studio.runtime.revisioned_commands import apply_revisioned_command


class DocumentEdits(Protocol):
    """An owner-bound store. Commit writes the CAS update and receipt atomically.

    Repeating a request returns its original result. Reusing its ID with different
    input raises an idempotency conflict. A concurrent CAS loser rechecks the
    receipt before reporting a revision conflict. ORM objects stay in the adapter.
    """

    async def load(self, project_id: str) -> AudioAnnotationDocumentOut: ...

    async def replay(
        self, project_id: str, command: AnnotationOperationsIn
    ) -> AudioAnnotationDocumentOut | None: ...

    async def commit(
        self,
        project_id: str,
        command: AnnotationOperationsIn,
        candidate: AudioAnnotationDocumentPutIn,
    ) -> AudioAnnotationDocumentOut: ...


class EditDocument:
    def __init__(self, store: DocumentEdits):
        self.store = store

    async def execute(
        self, project_id: str, command: AnnotationOperationsIn
    ) -> AudioAnnotationDocumentOut:
        return await apply_revisioned_command(
            self.store,
            project_id,
            command,
            transform=transform,
            describe=lambda snapshot: snapshot.model_dump(mode="json"),
        )
