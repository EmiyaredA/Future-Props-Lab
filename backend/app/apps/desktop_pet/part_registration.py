"""Validate optional static artwork registration, separate from physical joint poses."""

from __future__ import annotations

import math


def _finite(value: object, limit: float) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and abs(value) <= limit
    )


def _segment_ids(rig: dict) -> set[str]:
    poses = list(rig.get("poses", {}).values())
    for transition in rig.get("transitions") or []:
        for frame in transition["keyframes"]:
            if isinstance(frame["pose"], dict):
                poses.append(frame["pose"])
    return {
        part_id
        for pose in poses
        for limb in pose["limbs"].values()
        for part_id in limb.get("segments") or []
    }


def validate_part_registrations(model: dict) -> None:
    """Called after full rig validation; no uploaded mesh becomes renderer-owned data."""
    rig = model.get("motionRig")
    version_two = isinstance(rig, dict) and type(rig.get("version")) is int and rig["version"] == 2
    registered = _segment_ids(rig) if version_two else set()
    for part in model["parts"]:
        # These fields were never package contracts. Runtime meshes are compiled in memory.
        if "mesh" in part or "restAngle" in part:
            raise ValueError("资源包不支持运行时网格或未登记的旋转字段")
        if "restTransform" not in part:
            continue
        transform = part["restTransform"]
        if (
            not version_two
            or part["id"] not in registered
            or "skin" in part
            or not isinstance(transform, dict)
            or set(transform) != {"angle", "pivot"}
            or not _finite(transform["angle"], 180)
            or not isinstance(transform["pivot"], list)
            or len(transform["pivot"]) != 2
            or not all(_finite(n, 512) for n in transform["pivot"])
        ):
            raise ValueError("静态素材登记仅支持版本二刚性骨段及有限旋转锚点")
