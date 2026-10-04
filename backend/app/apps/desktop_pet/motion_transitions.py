"""Bounded directed authored-view transitions in private version-two resource packages."""

from __future__ import annotations

import math
import re
from collections.abc import Callable

from .authored_motion import EDGES, LIMBS, POSES, pose_point

TRANSITION_POSES = POSES | {"stand"}
NAME = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")


def pose_part_ids(pose: dict) -> set[str]:
    """Include profile-specific layers without imposing the human face protocol on whales."""
    ids = {pose["part"]}
    if pose.get("head") is not None:
        ids.add(pose["head"]["part"])
    for limb in pose["limbs"].values():
        ids.update(limb.get("segments") or [])
        if limb.get("part") is not None:
            ids.add(limb["part"])
    for group in pose.get("layers", {}).values():
        ids.update(group)
    return ids


def _endpoint(value: object) -> tuple[str, int, str | None]:
    if (
        not isinstance(value, dict)
        or not {"pose", "facing"} <= set(value)
        or set(value) - {"pose", "facing", "edge"}
        or not isinstance(value["pose"], str)
        or value["pose"] not in TRANSITION_POSES
        or type(value["facing"]) is not int
        or value["facing"] not in (-1, 1)
    ):
        raise ValueError("动作过渡端点无效")
    pose, edge = value["pose"], value.get("edge")
    allowed = {"side": {"left", "right"}, "top": {"top"}, "bottom": {"bottom"}}
    if (pose in allowed and (not isinstance(edge, str) or edge not in allowed[pose])) or (
        pose not in allowed and "edge" in value
    ):
        raise ValueError("动作过渡端点边缘无效")
    return pose, value["facing"], edge


def _supports(value: object, pose: dict) -> dict:
    if not isinstance(value, dict) or set(value) - LIMBS:
        raise ValueError("动作过渡支点清单无效")
    for limb, anchor in value.items():
        if (
            not isinstance(anchor, dict)
            or set(anchor) != {"edge", "point"}
            or not isinstance(anchor["edge"], str)
            or anchor["edge"] not in EDGES
            or not pose_point(anchor["point"])
            or math.dist(
                anchor["point"], pose["limbs"][limb].get("contact", pose["limbs"][limb]["end"])
            )
            > 1
        ):
            raise ValueError("动作过渡支点必须吻合姿势接触锚点")
    for edge in EDGES:
        axis = 0 if edge in ("left", "right") else 1
        coordinates = [a["point"][axis] for a in value.values() if a["edge"] == edge]
        if coordinates and max(coordinates) - min(coordinates) > 1:
            raise ValueError("同边动作过渡支点必须共面")
    if any(a["edge"] == "top" for a in value.values()) and not any(
        limb.startswith("arm") and anchor["edge"] == "top" for limb, anchor in value.items()
    ):
        raise ValueError("顶部动作过渡必须保持手部支撑")
    if (
        any(a["edge"] == "bottom" for a in value.values())
        and sum(a["edge"] == "bottom" for a in value.values()) < 2
    ):
        raise ValueError("底部动作过渡至少需要两个支点")
    return value


def validate_motion_transitions(
    rig: dict, validate_pose: Callable[[object, set[str]], None]
) -> set[str]:
    """Reuse a registered view only when its complete geometry/face/layer binding is identical."""
    registered = {part: pose for pose in rig["poses"].values() for part in pose_part_ids(pose)}
    if "transitions" not in rig:
        return set(registered)
    transitions = rig["transitions"]
    if not isinstance(transitions, list) or len(transitions) > 32:
        raise ValueError("动作过渡清单无效或过多")
    ids: set[str] = set()
    directions: set[tuple] = set()
    for transition in transitions:
        if (
            not isinstance(transition, dict)
            or set(transition) != {"id", "from", "to", "durationMs", "keyframes"}
            or not isinstance(transition["id"], str)
            or not NAME.fullmatch(transition["id"])
            or transition["id"] in ids
        ):
            raise ValueError("动作过渡定义或标识无效")
        ids.add(transition["id"])
        source, target = _endpoint(transition["from"]), _endpoint(transition["to"])
        direction = source, target
        if source == target or direction in directions:
            raise ValueError("动作过渡方向重复或没有变化")
        directions.add(direction)
        duration = transition["durationMs"]
        if (
            not isinstance(duration, (int, float))
            or isinstance(duration, bool)
            or not math.isfinite(duration)
            or not 80 <= duration <= 1500
        ):
            raise ValueError("动作过渡时长无效")
        frames = transition["keyframes"]
        attached = source[2] is not None and target[2] is not None
        corner = source[2] is not None and target[2] is not None and source[2] != target[2]
        if corner and {source[2], target[2]} in ({"left", "right"}, {"top", "bottom"}):
            raise ValueError("动作过渡只能交接相邻屏幕边缘")
        if not isinstance(frames, list) or not (3 if corner else 2) <= len(frames) <= 8:
            raise ValueError("动作过渡关键帧数量无效")
        previous_progress = -1.0
        previous_supports: dict | None = None
        for index, frame in enumerate(frames):
            if (
                not isinstance(frame, dict)
                or not {"progress", "pose"} <= set(frame)
                or set(frame) - {"progress", "pose", "supports", "viewFacing"}
            ):
                raise ValueError("动作过渡关键帧定义无效")
            if "viewFacing" in frame and (
                type(frame["viewFacing"]) is not int or frame["viewFacing"] not in (-1, 1)
            ):
                raise ValueError("动作过渡关键帧显示坐标基准无效")
            progress = frame["progress"]
            if (
                not isinstance(progress, (int, float))
                or isinstance(progress, bool)
                or not math.isfinite(progress)
                or not 0 <= progress <= 1
                or progress <= previous_progress
                or (index == 0 and progress != 0)
                or (index == len(frames) - 1 and progress != 1)
            ):
                raise ValueError("动作过渡关键帧进度必须从零到一严格递增")
            previous_progress = progress
            pose = frame["pose"]
            if isinstance(pose, str):
                if pose not in POSES:
                    raise ValueError("动作过渡引用未登记的运行姿势")
                if (index == 0 and pose != source[0]) or (
                    index == len(frames) - 1 and pose != target[0]
                ):
                    raise ValueError("动作过渡端点与引用姿势不匹配")
                pose = rig["poses"][pose]
            else:
                seen: set[str] = set()
                validate_pose(pose, seen)
                for part in seen:
                    if part in registered and registered[part] != pose:
                        raise ValueError("动作过渡分件不能复用不同姿势绑定")
                    registered[part] = pose
            supports = _supports(frame.get("supports", {}), pose)
            endpoint_edge = (
                source[2] if index == 0 else target[2] if index == len(frames) - 1 else None
            )
            if endpoint_edge is not None and not any(
                a["edge"] == endpoint_edge for a in supports.values()
            ):
                raise ValueError("附边动作过渡端点缺少对应边缘支撑")
            if attached:
                if not supports or any(
                    a["edge"] not in (source[2], target[2]) for a in supports.values()
                ):
                    raise ValueError("附边动作必须保持已声明边缘支撑")
                if previous_supports is not None and not any(
                    limb in supports
                    and anchor["edge"] == supports[limb]["edge"]
                    and math.dist(anchor["point"], supports[limb]["point"]) <= 1
                    for limb, anchor in previous_supports.items()
                ):
                    raise ValueError("附边动作必须交接连续的共同支点")
            previous_supports = supports
    return set(registered)
