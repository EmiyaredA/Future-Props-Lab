from app.runtime.operation_receipts import record, replay
from studio.apps.galgame_workshop.schemas import GalgameStoryDocumentOut
from studio.apps.galgame_workshop.story.operation_values import transform as transform
from studio.apps.galgame_workshop.story.story import GalgameStoryDocuments
from studio.runtime.revisions import RevisionConflictError


async def apply_operations(session, owner_user_id, project_id, body):
    documents = GalgameStoryDocuments(session)
    current = await documents.get(project_id)
    key = dict(owner_user_id=owner_user_id, kind="galgame", resource_id=project_id, body=body)
    saved = await replay(session, **key)
    if saved is not None:
        return GalgameStoryDocumentOut.model_validate(saved)
    if current.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision, current.revision, current.model_dump(mode="json")
        )
    candidate = transform(current, body)
    try:
        result = await documents.put(project_id, candidate, commit=False)
        record(session, **key, result=result)
        await session.commit()
        return result
    except RevisionConflictError:
        saved = await replay(session, **key)
        if saved is not None:
            return GalgameStoryDocumentOut.model_validate(saved)
        raise
    except Exception:
        await session.rollback()
        raise
