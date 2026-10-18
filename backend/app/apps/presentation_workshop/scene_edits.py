"""Pure native-scene edits shared by the presentation batch use case."""

from copy import deepcopy

from app.runtime.entity_edits import find
from app.runtime.operation_receipts import OperationError

COLLECTIONS = ("elements", "groups", "connections", "infographics")


def group_members(slide, root):
    groups = {root}
    for _ in slide["groups"]:
        groups.update(g["id"] for g in slide["groups"] if g["parent_id"] in groups)
    members = {i for g in slide["groups"] if g["id"] in groups for i in g["element_ids"]}
    return groups, members


def prune(slide, removed):
    slide["connections"] = [
        c
        for c in slide["connections"]
        if not removed.intersection((c["source_id"], c["target_id"]))
    ]
    for group in slide["groups"]:
        group["element_ids"] = [i for i in group["element_ids"] if i not in removed]


def remove_fragment(slide, identity):
    find(slide["groups"], identity)
    groups, members = group_members(slide, identity)
    if any(e["locked"] for e in slide["elements"] if e["id"] in members):
        raise OperationError("请先解锁分组成员", "element_locked", 409)
    slide["elements"] = [e for e in slide["elements"] if e["id"] not in members]
    slide["groups"] = [g for g in slide["groups"] if g["id"] not in groups]
    slide["infographics"] = [i for i in slide["infographics"] if i["group_id"] not in groups]
    prune(slide, members)


def remap(slide, namespace, *, offset=0):
    result = deepcopy(slide)
    mapping = {
        item["id"]: f"{namespace[:40]}-{kind[0]}{index}"
        for kind in COLLECTIONS
        for index, item in enumerate(result[kind])
    }
    for kind in COLLECTIONS:
        for item in result[kind]:
            item["id"] = mapping[item["id"]]
    for element in result["elements"]:
        element["x"] += offset
        element["y"] += offset
    for group in result["groups"]:
        group["element_ids"] = [mapping[i] for i in group["element_ids"]]
        group["parent_id"] = mapping.get(group["parent_id"])
    for connection in result["connections"]:
        connection["source_id"] = mapping[connection["source_id"]]
        connection["target_id"] = mapping[connection["target_id"]]
        for point in connection["waypoints"]:
            point["x"] += offset
            point["y"] += offset
    for info in result["infographics"]:
        info["group_id"] = mapping[info["group_id"]]
    return result


def apply_fragment(slide, op):
    if op.action == "remove":
        remove_fragment(slide, op.id)
        return
    if op.action not in {"insert", "update"} or op.fragment is None:
        raise OperationError("信息图片段需要 insert/update 和 fragment", "invalid_fragment")
    fragment = op.fragment.model_dump(mode="json")
    if fragment["reference"] or fragment["image_asset_id"] or fragment["id"] != op.id:
        raise OperationError("片段 ID 无效或包含页面参考图／图像版本", "invalid_fragment")
    roots = [g for g in fragment["groups"] if g["parent_id"] is None]
    if len(roots) != 1 or roots[0]["id"] != op.id:
        raise OperationError("片段必须有一个与 ID 相同的根组", "invalid_fragment")
    _, members = group_members(fragment, op.id)
    if members != {e["id"] for e in fragment["elements"]}:
        raise OperationError("片段元素必须全部属于根组", "invalid_fragment")
    if op.action == "update":
        remove_fragment(slide, op.id)
    for kind in COLLECTIONS:
        slide[kind].extend(fragment[kind])
