"""Pure ID-based list editing. Owners select collections and validate the final document."""

from copy import deepcopy

from app.runtime.operation_receipts import OperationError


def find(items, identity):
    for item in items:
        if item.get("id") == identity:
            return item
    raise OperationError(f"操作目标不存在：{identity}", "operation_target_not_found", 404)


def edit(items, operation):
    action, identity = operation.action, operation.id
    index = operation.index
    if action == "insert":
        if any(item.get("id") == identity for item in items):
            raise OperationError("不能创建重复 ID", "duplicate_id")
        value = {**deepcopy(operation.value), "id": identity}
        if operation.value.get("id", identity) != identity:
            raise OperationError("value.id 必须与操作 id 一致")
        if index is not None and index > len(items):
            raise OperationError("插入位置超出范围")
        items.insert(len(items) if index is None else index, value)
        return value
    item = find(items, identity)
    if action == "update":
        if "id" in operation.value and operation.value["id"] != identity:
            raise OperationError("更新不能改变 ID")
        unknown = set(operation.value) - set(item)
        if unknown:
            raise OperationError("未知字段：" + ", ".join(sorted(unknown)))
        item.update(deepcopy(operation.value))
    elif action == "remove":
        items.remove(item)
    elif action == "move":
        if index is None or index >= len(items):
            raise OperationError("移动位置超出范围")
        items.remove(item)
        items.insert(index, item)
    elif action == "duplicate":
        clone = deepcopy(item)
        new_id = operation.value.get("id")
        if not new_id or any(x["id"] == new_id for x in items):
            raise OperationError("复制必须提供未使用的 value.id")
        clone.update(deepcopy(operation.value))
        if index is not None and index > len(items):
            raise OperationError("复制位置超出范围")
        items.insert(len(items) if index is None else index, clone)
        return clone
    return item
