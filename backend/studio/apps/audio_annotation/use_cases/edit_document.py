"""Apply an idempotent document command through an atomic storage port."""

from typing import Protocol

from studio.apps.audio_annotation.rules.editing import transform
from studio.apps.audio_annotation.schemas.document import (
    AudioAnnotationDocumentOut,
    AudioAnnotationDocumentPutIn,
)
from studio.apps.audio_annotation.schemas.operations import AnnotationOperationsIn
from studio.runtime.revisions import RevisionConflictError


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
        # Check resource access before replay, including when a resource was deleted.
        current = await self.store.load(project_id)
        saved = await self.store.replay(project_id, command)
        if saved is not None:
            return saved
        if current.revision != command.expected_revision:
            raise RevisionConflictError(
                command.expected_revision, current.revision, current.model_dump(mode="json")
            )
        candidate = transform(current, command)
        return await self.store.commit(project_id, command, candidate)
