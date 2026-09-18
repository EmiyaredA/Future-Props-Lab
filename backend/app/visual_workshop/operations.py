from app.runtime.entity_edits import edit
from app.runtime.operation_receipts import record, replay
from app.runtime.revisions import RevisionConflictError
from app.schemas.visual_workshop import VisualCanvasDocumentOut, VisualCanvasDocumentPutIn
from app.visual_workshop.canvas import VisualCanvasDocuments


def transform(current, body):
    data = current.model_dump(mode="json")
    for op in body.operations:
        edit(data["nodes" if op.entity == "node" else "edges"], op)
        if op.entity == "node" and op.action == "remove":
            data["edges"] = [
                e for e in data["edges"] if op.id not in (e["source_node_id"], e["target_node_id"])
            ]
    return VisualCanvasDocumentPutIn(
        nodes=data["nodes"],
        edges=data["edges"],
        expected_revision=body.expected_revision,
    )


async def apply_operations(session, workspace_id, project_id, body):
    documents = VisualCanvasDocuments(session)
    current = await documents.get(project_id)
    key = dict(workspace_id=workspace_id, kind="visual", resource_id=project_id, body=body)
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
