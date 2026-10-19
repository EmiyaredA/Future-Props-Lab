from app.apps.presentation_workshop.projects import Presentations
from app.apps.presentation_workshop.scene_edits import (
    apply_fragment,
    prune,
    rebase_layers_after_removal,
    remap,
)
from app.apps.presentation_workshop.schemas.document import (
    PresentationProjectOut,
    PresentationProjectPut,
)
from app.runtime.entity_edits import edit, find
from app.runtime.operation_receipts import OperationError, record, replay
from app.runtime.revisions import RevisionConflictError


def transform(current, body):
    document = current.document.model_dump(mode="json")
    for op in body.operations:
        slides = document["slides"]
        if op.entity == "fragment":
            apply_fragment(find(slides, op.parent_id), op)
            continue
        owner = None if op.entity == "slide" else find(slides, op.parent_id)
        collection = {
            "element": "elements",
            "group": "groups",
            "connection": "connections",
            "infographic": "infographics",
        }
        items = slides if owner is None else owner[collection[op.entity]]
        removed_group = (
            find(items, op.id) if op.entity == "group" and op.action == "remove" else None
        )
        if op.entity == "element" and op.action not in {"insert", "duplicate"}:
            item = find(items, op.id)
            if item["locked"] and not (op.action == "update" and op.value == {"locked": False}):
                raise OperationError("请先解锁元素", "element_locked", 409)
        if owner and op.entity == "element" and op.action == "remove":
            rebase_layers_after_removal(owner, {op.id})
        clone = edit(items, op)
        if owner and op.entity == "element" and op.action == "update":
            if {"x", "y", "width", "height", "rotation"}.intersection(op.value):
                for connection in owner["connections"]:
                    if op.id in (connection["source_id"], connection["target_id"]):
                        connection["waypoints"] = []
        if owner and op.action == "remove":
            if op.entity == "element":
                prune(owner, {op.id})
            elif op.entity == "group":
                for group in owner["groups"]:
                    if group["parent_id"] == op.id:
                        group["parent_id"] = removed_group["parent_id"]
                    if group["id"] == removed_group["parent_id"]:
                        group["element_ids"].extend(removed_group["element_ids"])
                owner["infographics"] = [i for i in owner["infographics"] if i["group_id"] != op.id]
        if op.entity == "slide" and op.action == "duplicate":
            # New slide IDs deterministically namespace child IDs; no duplicate global identities.
            clone.update(remap(clone, clone["id"]))
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
