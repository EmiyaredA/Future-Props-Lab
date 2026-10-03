"""Versioned, data-only joint rig validation for articulated human resource packages."""

from __future__ import annotations

import math

LIMBS = ("armNear", "armFar", "legBack", "legFront")
JOINT_PARENTS = {f"{name}{suffix}" for name in LIMBS for suffix in ("Lower", "End")}


def validate_motion_rig(model: dict) -> None:
    rig = model.get("motionRig")
    if rig is None:
        return
    if model.get("rigProfile") != "human-chibi" or not isinstance(rig, dict):
        raise ValueError("关节骨架仅支持人物桌宠")
    if type(rig.get("version")) is not int or rig["version"] != 1:
        raise ValueError("人物动作骨架版本不支持")
    limbs = rig.get("limbs")
    if not isinstance(limbs, dict) or set(limbs) != set(LIMBS):
        raise ValueError("人物动作骨架缺少四肢")
    parts = {part["id"]: part for part in model["parts"]}
    used: set[str] = set()
    for name in LIMBS:
        limb = limbs[name]
        if not isinstance(limb, dict):
            raise ValueError("人物关节定义无效")
        points = []
        for key in ("root", "joint", "end"):
            point = limb.get(key)
            if (
                not isinstance(point, list)
                or len(point) != 2
                or any(
                    not isinstance(n, (int, float))
                    or isinstance(n, bool)
                    or not math.isfinite(n)
                    or abs(n) > 512
                    for n in point
                )
            ):
                raise ValueError("人物关节坐标无效")
            points.append(point)
        if any(not 1 <= math.dist(a, b) <= 256 for a, b in zip(points, points[1:])):
            raise ValueError("人物骨段长度无效")
        ids = limb.get("parts")
        if (
            not isinstance(ids, list)
            or len(ids) != 3
            or any(not isinstance(item, str) for item in ids)
            or len(set(ids)) != 3
        ):
            raise ValueError("人物骨段分件无效")
        for part_id, parent in zip(ids, (name, f"{name}Lower", f"{name}End")):
            if part_id not in parts or part_id in used or parts[part_id]["parent"] != parent:
                raise ValueError("人物骨段分件引用或父关节无效")
            used.add(part_id)
        patch = limb.get("jointPart")
        if patch is not None:
            if (
                not isinstance(patch, str)
                or patch not in parts
                or patch in used
                or parts[patch]["parent"] != f"{name}Lower"
            ):
                raise ValueError("人物关节补画引用无效")
            used.add(patch)
    hidden = rig.get("hiddenParts")
    if (
        not isinstance(hidden, list)
        or not 1 <= len(hidden) <= 8
        or any(not isinstance(item, str) or item not in parts or item in used for item in hidden)
        or len(set(hidden)) != len(hidden)
    ):
        raise ValueError("人物旧分件替换清单无效")
    if any(part["parent"] in JOINT_PARENTS and part_id not in used for part_id, part in parts.items()):
        raise ValueError("存在未登记的人物关节分件")
