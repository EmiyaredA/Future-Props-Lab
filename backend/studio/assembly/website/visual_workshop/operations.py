"""Website transaction adapter for visual edit receipts."""

from studio.apps.visual_workshop.operations import apply_operations as apply_command
from studio.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentOut
from studio.assembly.website.visual_workshop.canvas import VisualCanvasDocuments
from studio.runtime.database.operation_receipts import record, replay
from studio.runtime.revisions import RevisionConflictError


class SqlDocumentEdits:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner
        self.documents = VisualCanvasDocuments(session)

    def key(self, resource, command):
        return dict(owner_user_id=self.owner, kind="visual", resource_id=resource, body=command)

    async def load(self, resource):
        return await self.documents.get(resource)

    async def replay(self, resource, command):
        saved = await replay(self.session, **self.key(resource, command))
        return None if saved is None else VisualCanvasDocumentOut.model_validate(saved)

    async def commit(self, resource, command, candidate):
        try:
            result = await self.documents.replace(resource, candidate)
            record(self.session, **self.key(resource, command), result=result)
            await self.session.commit()
            return result
        except RevisionConflictError:
            saved = await self.replay(resource, command)
            if saved is not None:
                return saved
            raise
        except BaseException:
            await self.session.rollback()
            raise


async def apply_operations(session, owner_user_id, project_id, body):
    return await apply_command(SqlDocumentEdits(session, owner_user_id), project_id, body)
