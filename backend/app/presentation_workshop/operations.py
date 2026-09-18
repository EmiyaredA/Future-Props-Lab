from app.presentation_workshop.projects import Presentations
from app.runtime.entity_edits import edit, find
from app.runtime.operation_receipts import OperationError, record, replay
from app.runtime.revisions import RevisionConflictError
from app.schemas.presentation_workshop import PresentationProjectOut, PresentationProjectPut


def transform(current, body):
    document = current.document.model_dump(mode="json")
    for op in body.operations:
        slides = document["slides"]
        items = slides if op.entity == "slide" else find(slides, op.parent_id)["elements"]
        if op.entity == "element" and op.action not in {"insert", "duplicate"}:
            item = find(items, op.id)
            if item["locked"] and not (op.action == "update" and op.value == {"locked": False}):
                raise OperationError("请先解锁元素", "element_locked", 409)
        clone = edit(items, op)
        if op.entity == "slide" and op.action == "duplicate":
            # New slide IDs deterministically namespace child IDs; no duplicate global identities.
            for index, element in enumerate(clone["elements"]):
                element["id"] = f"{clone['id'][:48]}-element-{index}"
    return PresentationProjectPut(
        title=current.title, document=document, expected_revision=body.expected_revision
    )


async def apply_operations(session, workspace_id, project_id, body):
    projects = Presentations(session, workspace_id)
    current = await projects.get(project_id)
    key = dict(workspace_id=workspace_id, kind="presentation", resource_id=project_id, body=body)
    saved = await replay(session, **key)
    if saved is not None:
        return PresentationProjectOut.model_validate(saved)
    if current.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision, current.revision, current.model_dump(mode="json")
        )
    candidate = transform(current, body)
    try:
        result = await projects.put(project_id, candidate, commit=False)
        record(session, **key, result=result)
        await session.commit()
        return result
    except RevisionConflictError:
        saved = await replay(session, **key)
        if saved is not None:
            return PresentationProjectOut.model_validate(saved)
        raise
    except Exception:
        await session.rollback()
        raise
