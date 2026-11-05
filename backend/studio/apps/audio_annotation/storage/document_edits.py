"""SQLite adapter for document updates and their same-transaction receipts."""

from studio.apps.audio_annotation.schemas.document import AudioAnnotationDocumentOut
from studio.apps.audio_annotation.storage.projects import ProjectRecords
from studio.runtime.database.operation_receipts import record, replay
from studio.runtime.revisions import RevisionConflictError


class SqlDocumentEdits:
    def __init__(self, session, owner_user_id, projects: ProjectRecords):
        self.session = session
        self.owner_user_id = owner_user_id
        self.projects = projects

    def receipt_key(self, project_id, command):
        return dict(
            owner_user_id=self.owner_user_id,
            kind="annotation",
            resource_id=project_id,
            body=command,
        )

    async def load(self, project_id):
        return await self.projects.get_document(project_id)

    async def replay(self, project_id, command):
        saved = await replay(self.session, **self.receipt_key(project_id, command))
        return None if saved is None else AudioAnnotationDocumentOut.model_validate(saved)

    async def commit(self, project_id, command, candidate):
        try:
            result = await self.projects.put_document(project_id, candidate, commit=False)
            record(self.session, **self.receipt_key(project_id, command), result=result)
            await self.session.commit()
            return result
        except RevisionConflictError:
            saved = await self.replay(project_id, command)
            if saved is not None:
                return saved
            raise
        except BaseException:
            # Cancellation is a failed transaction too; never leave staged receipts.
            await self.session.rollback()
            raise
