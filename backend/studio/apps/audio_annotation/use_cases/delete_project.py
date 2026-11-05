"""Delete a verified project revision without deleting its source audio."""

from typing import Protocol

from studio.apps.audio_annotation.schemas.document import AudioAnnotationProjectOut
from studio.runtime.revisions import RevisionConflictError


class ProjectDeletion(Protocol):
    async def get(self, project_id: str) -> AudioAnnotationProjectOut:
        """Return an owned snapshot; foreign or missing IDs are indistinguishable."""
        ...

    async def commit_deletion(self, project_id: str, expected_revision: int) -> None:
        """CAS-delete the root, children, edit receipts and reference delivery.

        Recheck revision in the write transaction after any external preparation.
        Rollback aborts prepared references; an unknown commit is reconciled rather
        than blindly repeated. Source audio belongs to Assets and is never deleted.
        """
        ...


class DeleteProject:
    def __init__(self, store: ProjectDeletion):
        self.store = store

    async def execute(self, project_id: str, expected_revision: int) -> None:
        current = await self.store.get(project_id)
        if current.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision, current.revision, current.model_dump(mode="json")
            )
        await self.store.commit_deletion(project_id, expected_revision)
