"""Website transaction adapter for galgame edit receipts."""

from studio.apps.galgame_workshop.schemas import GalgameStoryDocumentOut
from studio.apps.galgame_workshop.story.operations import apply_operations as apply_command
from studio.assembly.website.galgame_workshop.story.story import GalgameStoryDocuments
from studio.runtime.database.operation_receipts import record, replay
from studio.runtime.revisions import RevisionConflictError


class SqlDocumentEdits:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner
        self.documents = GalgameStoryDocuments(session)

    def key(self, resource, command):
        return dict(owner_user_id=self.owner, kind="galgame", resource_id=resource, body=command)

    async def load(self, resource):
        return await self.documents.get(resource)

    async def replay(self, resource, command):
        saved = await replay(self.session, **self.key(resource, command))
        return None if saved is None else GalgameStoryDocumentOut.model_validate(saved)

    async def commit(self, resource, command, candidate):
        try:
            result = await self.documents.put(resource, candidate, commit=False)
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
