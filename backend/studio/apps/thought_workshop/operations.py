from copy import deepcopy

from studio.apps.thought_workshop.notes import Notes, note_out
from studio.apps.thought_workshop.schemas.workshop import ThoughtNoteOut, ThoughtNotePut
from studio.runtime.database.operation_receipts import OperationError, record, replay
from studio.runtime.revisions import RevisionConflictError


def transform(current, body):
    document = deepcopy(current.document)
    for op in body.operations:
        if any(index < 0 for index in op.path):
            raise OperationError("内容路径不能包含负数")
        node = document
        for index in op.path[:-1]:
            content = node.get("content", [])
            if index >= len(content):
                raise OperationError("内容路径不存在")
            node = content[index]
        items = node.setdefault("content", [])
        index = op.path[-1]
        if op.action == "insert":
            if index > len(items):
                raise OperationError("插入位置超出范围")
            items.insert(index, deepcopy(op.value))
            continue
        if index >= len(items):
            raise OperationError("内容路径不存在")
        item = items[index]
        if op.action == "replace":
            items[index] = deepcopy(op.value)
        elif op.action == "remove":
            items.pop(index)
        elif op.action == "move":
            if op.target_index is None or op.target_index >= len(items):
                raise OperationError("移动位置超出范围")
            items.insert(op.target_index, items.pop(index))
        elif op.action == "replace_text":
            text = item.get("text")
            if item.get("type") != "text" or not isinstance(text, str):
                raise OperationError("replace_text 必须定位到文本节点")
            end = len(text) if op.end is None else op.end
            if not 0 <= op.start <= end <= len(text):
                raise OperationError("文本范围超出当前节点")
            item["text"] = text[: op.start] + op.text + text[end:]
            if not item["text"]:
                items.pop(index)
        elif op.action == "set_marks":
            item["marks"] = deepcopy(op.marks)
        elif op.action == "set_attrs":
            item["attrs"] = {**item.get("attrs", {}), **deepcopy(op.value)}
    values = {
        name: getattr(current, name)
        for name in ThoughtNotePut.model_fields
        if name not in {"expected_revision", "document"}
    }
    return ThoughtNotePut(**values, document=document, expected_revision=body.expected_revision)


async def apply_operations(
    session, owner_user_id, note_id, body, author_id=None, *, assets, accounts=None
):
    notes = Notes(session, owner_user_id, author_id, assets=assets, accounts=accounts)
    current = note_out(await notes.get(note_id))
    key = dict(owner_user_id=owner_user_id, kind="thought", resource_id=note_id, body=body)
    saved = await replay(session, **key)
    if saved is not None:
        return ThoughtNoteOut.model_validate(saved)
    if current.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision, current.revision, current.model_dump(mode="json")
        )
    candidate = transform(current, body)
    try:
        result = await notes.put(note_id, candidate, commit=False)
        record(session, **key, result=result)
        await session.commit()
        return result
    except RevisionConflictError:
        saved = await replay(session, **key)
        if saved is not None:
            return ThoughtNoteOut.model_validate(saved)
        raise
    except Exception:
        await session.rollback()
        raise
