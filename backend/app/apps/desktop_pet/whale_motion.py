"""Explicit version-two whale pose geometry and canonical whale face/layer bindings."""

from __future__ import annotations

import math

from .authored_motion import EDGES, POSES, pose_point, validate_pose_geometry
from .motion_transitions import validate_motion_transitions

LAYER_SLOTS = {"headBack", "headFront", "skirt", "tail", "finNear", "finFar"}
PARENTS = {
    "body",
    "torso",
    "neck",
    "skirt",
    "skirtSit",
    "armNear",
    "armFar",
    "legBack",
    "legFront",
    "tail",
    "tailBend",
    "headBack",
    "headMid",
    "headFeat",
    "headFront",
    "hairSway",
    "bangsSway",
    "finNear",
    "finFar",
    "ahoge",
    "brows",
    "creases",
}


def _finite(value: object, limit: float = 8192) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and abs(value) <= limit
    )


def _rect(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 4
        and all(_finite(n) for n in value)
        and value[2] > value[0]
        and value[3] > value[1]
        and value[2] - value[0] <= 4096
        and value[3] - value[1] <= 4096
    )


def _canonical_face(feat: object) -> None:
    """Keep the existing master-pixel eye layers and lid curves, not human seven-sprite faces."""
    if (
        not isinstance(feat, dict)
        or set(feat) != {"sprites", "eyes"}
        or not isinstance(feat.get("eyes"), dict)
        or set(feat["eyes"]) != {"eyeL", "eyeR"}
    ):
        raise ValueError("鲸鱼动作缺少原生五官")
    sprites = feat.get("sprites")
    if (
        not isinstance(sprites, dict)
        or "neutral_mouth" not in sprites
        or not all(_rect(box) for box in sprites.values())
    ):
        raise ValueError("鲸鱼动作表情位置无效")
    for name in ("eyeL", "eyeR"):
        eye = feat["eyes"].get(name)
        if (
            not isinstance(eye, dict)
            or set(eye) - {"lash", "ball", "iris", "rim", "lidFit", "rimFit"}
            or not all(_rect(eye.get(key)) for key in ("lash", "ball", "iris"))
            or ("rim" in eye and not _rect(eye["rim"]))
            or any(
                not isinstance(eye.get(key), list)
                or len(eye[key]) != 3
                or not all(_finite(n) for n in eye[key])
                for key in ("lidFit", "rimFit")
            )
        ):
            raise ValueError("鲸鱼动作眼睛分层或眼睑曲线无效")


def _face_projection(value: object) -> None:
    if not isinstance(value, dict) or set(value) != {"kind", "transform", "clip"}:
        raise ValueError("鲸鱼动作五官投影定义无效")
    if value["kind"] != "whale":
        raise ValueError("鲸鱼动作只能使用原生五官合成")
    transform = value["transform"]
    if (
        not isinstance(transform, list)
        or len(transform) != 6
        or not all(_finite(n, 4 if i < 4 else 512) for i, n in enumerate(transform))
        # Canvas affine convention: x'=a*x+c*y+tx, y'=b*x+d*y+ty.
        # Reflection belongs to the figure's facing transform, not its face projection.
        or transform[0] * transform[3] - transform[1] * transform[2] <= 1e-8
    ):
        raise ValueError("鲸鱼动作五官投影必须有限、非退化且不镜像")
    clip = value["clip"]
    if (
        not isinstance(clip, list)
        or not 3 <= len(clip) <= 16
        or not all(pose_point(point) for point in clip)
        or abs(
            sum(p[0] * q[1] - p[1] * q[0] for p, q in zip(clip, clip[1:] + clip[:1], strict=True))
        )
        <= 0.01
    ):
        raise ValueError("鲸鱼动作五官遮挡范围无效")


def validate_whale_motion_rig(model: dict) -> None:
    rig = model.get("motionRig")
    if (
        not isinstance(rig, dict)
        or not {"version", "waist", "neck", "hiddenParts", "poses", "supportedEdges"} <= set(rig)
        or set(rig)
        - {"version", "waist", "neck", "hiddenParts", "poses", "supportedEdges", "transitions"}
        or type(rig["version"]) is not int
        or rig["version"] != 2
        or not pose_point(rig["waist"])
        or not pose_point(rig["neck"])
    ):
        raise ValueError("鲸鱼动作骨架需要完整版本二描述")
    edges = rig["supportedEdges"]
    if (
        not isinstance(edges, list)
        or len(edges) != 4
        or any(not isinstance(edge, str) for edge in edges)
        or set(edges) != EDGES
    ):
        raise ValueError("鲸鱼动作四边能力声明无效")
    parts = {part["id"]: part for part in model["parts"]}
    if any(
        part.get("parent") not in PARENTS
        or part["id"] in {"faceFx", "brows_through"}
        or part["tex"] == "faceFx"
        or set(part) - {"id", "tex", "parent", "z", "box", "grid", "uvBox", "alpha"}
        or ("alpha" in part and (not _finite(part["alpha"], 1) or part["alpha"] < 0))
        for part in parts.values()
    ):
        raise ValueError("鲸鱼动作分件父级或字段未登记")
    hidden = rig["hiddenParts"]
    if (
        not isinstance(hidden, list)
        or not 1 <= len(hidden) <= 80
        or any(not isinstance(key, str) or key not in parts for key in hidden)
        or len(set(hidden)) != len(hidden)
    ):
        raise ValueError("鲸鱼动作旧分件替换清单无效")
    _canonical_face(model.get("feat"))
    poses = rig["poses"]
    if not isinstance(poses, dict) or set(poses) != POSES:
        raise ValueError("鲸鱼动作缺少完整六种姿势")
    seen: set[str] = set()
    for pose in poses.values():
        validate_whale_pose(pose, parts, seen)
    all_parts = validate_motion_transitions(
        rig, lambda pose, registered: validate_whale_pose(pose, parts, registered)
    )
    if all_parts.intersection(hidden):
        raise ValueError("鲸鱼动作分件不能同时作为旧分件隐藏")


def validate_whale_pose(pose: object, parts: dict, seen: set[str]) -> None:
    """Validate one native whale view for either a running pose or an authored transition."""
    required = {"part", "waist", "neck", "limbs", "edges", "layers", "face"}
    if (
        not isinstance(pose, dict)
        or not required <= set(pose)
        or set(pose) - required - {"stride"}
        or not pose_point(pose["neck"])
    ):
        raise ValueError("鲸鱼动作姿势定义无效")
    validate_pose_geometry(pose, parts, seen)
    if any(not limb.get("segments") and not limb.get("part") for limb in pose["limbs"].values()):
        raise ValueError("鲸鱼动作需要独立四肢素材")
    layers = pose["layers"]
    if not isinstance(layers, dict) or set(layers) != LAYER_SLOTS:
        raise ValueError("鲸鱼动作头部、鳍尾和裙摆绑定不完整")
    for slot, ids in layers.items():
        if (
            not isinstance(ids, list)
            or not (0 if slot == "headBack" else 1) <= len(ids) <= 4
            or any(
                not isinstance(key, str)
                or key not in parts
                or key in seen
                or parts[key]["parent"] != "body"
                for key in ids
            )
            or len(set(ids)) != len(ids)
        ):
            raise ValueError("鲸鱼动作层素材引用无效")
        seen.update(ids)
    _face_projection(pose["face"])
