from app.apps.presentation_workshop.connection_routes import follow_batch
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
    before = current.document.model_dump(mode="json")
    explicit_paths = set()
    removed_slides = set()
    for op in body.operations:
        if op.entity == "slide" and op.action == "remove":
            removed_slides.add(op.id)
        if op.entity == "connection" and op.action == "update" and "waypoints" in op.value:
            explicit_paths.add((op.parent_id, op.id))
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
            for element in clone["elements"]:
                if (
                    element.get("link")
                    and element["link"]["type"] == "slide"
                    and element["link"]["target"] == op.id
                ):
                    element["link"]["target"] = clone["id"]
    present = {page["id"] for page in document["slides"]}
    for page in document["slides"]:
        for element in page["elements"]:
            link = element.get("link")
            if link and link["type"] == "slide" and link["target"] in removed_slides - present:
                element["link"] = None
    try:
        follow_batch(before, document, explicit_paths)
    except ValueError as exc:
        raise OperationError(str(exc), "connection_route_limit", 422) from exc
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
