from app.apps.visual_workshop.canvas import VisualCanvasDocuments
from app.apps.visual_workshop.operation_values import transform as transform
from app.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
)
from app.runtime.operation_receipts import record, replay
from app.runtime.revisions import RevisionConflictError


async def apply_operations(session, owner_user_id, project_id, body):
    documents = VisualCanvasDocuments(session)
    current = await documents.get(project_id)
    key = dict(owner_user_id=owner_user_id, kind="visual", resource_id=project_id, body=body)
    saved = await replay(session, **key)
    if saved is not None:
        return VisualCanvasDocumentOut.model_validate(saved)
    if current.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision, current.revision, current.model_dump(mode="json")
        )
    candidate = transform(current, body)
    try:
        result = await documents.replace(project_id, candidate)
        record(session, **key, result=result)
        await session.commit()
        return result
    except RevisionConflictError:
        saved = await replay(session, **key)
        if saved is not None:
            return VisualCanvasDocumentOut.model_validate(saved)
        raise
    except Exception:
        await session.rollback()
        raise
