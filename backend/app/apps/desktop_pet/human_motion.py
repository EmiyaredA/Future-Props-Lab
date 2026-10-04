"""Versioned, data-only joint rig validation for articulated human resource packages."""

from __future__ import annotations

import math

from .authored_motion import validate_authored_pose, validate_authored_poses
from .motion_transitions import validate_motion_transitions
from .whale_motion import validate_whale_motion_rig

LIMBS = ("armNear", "armFar", "legBack", "legFront")
JOINT_PARENTS = {f"{name}{suffix}" for name in LIMBS for suffix in ("Lower", "End")}


def validate_motion_rig(model: dict) -> None:
    rig = model.get("motionRig")
    if rig is None:
        return
    if model.get("rigProfile", "whale") == "whale":
        validate_whale_motion_rig(model)
        return
    if model.get("rigProfile") != "human-chibi" or not isinstance(rig, dict):
        raise ValueError("关节骨架仅支持人物桌宠")
    if type(rig.get("version")) is not int or rig["version"] not in (1, 2):
        raise ValueError("人物动作骨架版本不支持")
    if rig["version"] == 1 and "transitions" in rig:
        raise ValueError("动作过渡仅支持版本二资源包")
    limbs = rig.get("limbs")
    for anchor in ("waist", "neck"):
        point = rig.get(anchor)
        if point is not None and (
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
            raise ValueError("人物动作锚点无效")
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
        if any(not 1 <= math.dist(a, b) <= 256 for a, b in zip(points, points[1:], strict=False)):
            raise ValueError("人物骨段长度无效")
        ids = limb.get("parts")
        if (
            not isinstance(ids, list)
            or len(ids) != 3
            or any(not isinstance(item, str) for item in ids)
            or len(set(ids)) != 3
        ):
            raise ValueError("人物骨段分件无效")
        for part_id, parent in zip(ids, (name, f"{name}Lower", f"{name}End"), strict=True):
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
    if any(
        part["parent"] in JOINT_PARENTS and part_id not in used for part_id, part in parts.items()
    ):
        raise ValueError("存在未登记的人物关节分件")

    profile = rig.get("profileHead")
    if profile is not None:
        if not isinstance(profile, dict) or not isinstance(profile.get("part"), str):
            raise ValueError("人物侧向头部定义无效")
        head = parts.get(profile["part"])
        if head is None or head["parent"] != "head" or head["id"] in used:
            raise ValueError("人物侧向头部分件引用无效")
        hidden_head = profile.get("hiddenParts")
        if (
            not isinstance(hidden_head, list)
            or not 1 <= len(hidden_head) <= 8
            or any(
                not isinstance(item, str) or item not in parts or item == head["id"] or item in used
                for item in hidden_head
            )
            or len(set(hidden_head)) != len(hidden_head)
        ):
            raise ValueError("人物侧向头部替换清单无效")
        for key in ("eye", "brow", "mouth"):
            rect = profile.get(key)
            if (
                not isinstance(rect, list)
                or len(rect) != 4
                or any(
                    not isinstance(n, (int, float))
                    or isinstance(n, bool)
                    or not math.isfinite(n)
                    or abs(n) > 512
                    for n in rect
                )
                or rect[2] <= 0
                or rect[3] <= 0
            ):
                raise ValueError("人物侧向五官位置无效")
    if rig["version"] == 2:
        features = model.get("feat", {}).get("sprites", {})
        validate_authored_poses(rig.get("poses"), parts, features)
        validate_motion_transitions(
            rig, lambda pose, seen: validate_authored_pose(pose, parts, features, seen)
        )
