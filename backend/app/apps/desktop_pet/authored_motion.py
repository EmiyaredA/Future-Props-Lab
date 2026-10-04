"""Data-only anatomical pose bindings for version two character packages."""

from __future__ import annotations

import math

POSES = {"walk", "held", "side", "top", "bottom", "glide"}
LIMBS = {"armNear", "armFar", "legBack", "legFront"}
EDGES = {"left", "right", "top", "bottom"}
FEATURES = {
    "eyes",
    "closed_eyes",
    "angry_eyes",
    "surprised_eyes",
    "brows",
    "neutral_mouth",
    "happy_mouth",
}


def pose_point(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 2
        and all(
            isinstance(n, (int, float))
            and not isinstance(n, bool)
            and math.isfinite(n)
            and abs(n) <= 512
            for n in value
        )
    )


def validate_authored_poses(value: object, parts: dict, features: dict) -> None:
    if not isinstance(value, dict) or set(value) != POSES:
        raise ValueError("人物动作姿势不完整")
    seen: set[str] = set()
    for pose in value.values():
        validate_authored_pose(pose, parts, features, seen)


def validate_authored_pose(pose: object, parts: dict, features: dict, seen: set[str]) -> None:
    """One complete authored view; transitions share the same geometry and face rules."""
    if (
        not isinstance(pose, dict)
        or not {"part", "waist", "limbs", "edges", "face"} <= set(pose)
        or set(pose) - {"part", "waist", "limbs", "edges", "face", "stride", "head"}
    ):
        raise ValueError("人物动作姿势定义无效")
    validate_pose_geometry(pose, parts, seen)
    head = pose.get("head")
    if head is not None:
        if (
            not isinstance(head, dict)
            or set(head) != {"part", "neck"}
            or not isinstance(head["part"], str)
            or head["part"] not in parts
            or head["part"] in seen
            or parts[head["part"]]["parent"] != "body"
            or not pose_point(head["neck"])
        ):
            raise ValueError("人物动作头部分件无效")
        seen.add(head["part"])
    face = pose["face"]
    if (
        not isinstance(face, dict)
        or not {"eye", "brow", "mouth", "twoEyes", "angle"} <= set(face)
        or set(face)
        - {"eye", "brow", "mouth", "twoEyes", "angle", "sprites", "clip", "sourceRects"}
        or type(face["twoEyes"]) is not bool
    ):
        raise ValueError("人物姿势五官无效")
    clip = face.get("clip")
    if clip is not None and (
        not isinstance(clip, list)
        or not 3 <= len(clip) <= 16
        or not all(pose_point(p) for p in clip)
    ):
        raise ValueError("人物姿势面部遮挡范围无效")
    if "sprites" in face and (
        not isinstance(face["sprites"], dict)
        or not face["sprites"]
        or set(face["sprites"]) - FEATURES
        or any(
            not isinstance(name, str) or name not in features for name in face["sprites"].values()
        )
    ):
        raise ValueError("人物姿势五官素材引用无效")
    source_rects = face.get("sourceRects")
    if source_rects is not None and (
        not isinstance(source_rects, dict)
        or not source_rects
        or set(source_rects) - FEATURES
        or any(not source_rectangle(rect) for rect in source_rects.values())
    ):
        raise ValueError("人物姿势五官源裁切范围无效")
    if (
        not isinstance(face["angle"], (int, float))
        or isinstance(face["angle"], bool)
        or not math.isfinite(face["angle"])
        or abs(face["angle"]) > 90
    ):
        raise ValueError("人物姿势五官角度无效")
    for key in ("eye", "brow", "mouth"):
        box = face[key]
        if (
            not isinstance(box, list)
            or len(box) != 4
            or not pose_point(box[:2])
            or not pose_point(box[2:])
            or min(box[2:]) <= 0
        ):
            raise ValueError("人物姿势五官位置无效")


def source_rectangle(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 4
        and all(
            isinstance(n, (int, float))
            and not isinstance(n, bool)
            and math.isfinite(n)
            and 0 <= n <= 4096
            for n in value
        )
        and value[2] > 0
        and value[3] > 0
        and value[0] + value[2] <= 4096
        and value[1] + value[3] <= 4096
    )


def validate_face_source_images(model: dict, dimensions: dict[str, tuple[int, int]]) -> None:
    """Every crop references the actual authorized image, including all outfit variants."""
    if model.get("rigProfile") != "human-chibi":
        return
    rig = model.get("motionRig") or {}
    poses = list(rig.get("poses", {}).values())
    poses.extend(
        frame["pose"]
        for transition in rig.get("transitions", [])
        for frame in transition["keyframes"]
        if isinstance(frame["pose"], dict)
    )
    for pose in poses:
        face = pose["face"]
        for feature, rect in face.get("sourceRects", {}).items():
            sprite = face.get("sprites", {}).get(feature, feature)
            for index, scheme in enumerate(model["schemes"]):
                prefix = "" if index == 0 else f"schemes/{scheme['id']}/"
                width, height = dimensions[f"{prefix}feat/{sprite}.png"]
                if rect[0] + rect[2] > width or rect[1] + rect[3] > height:
                    raise ValueError("人物姿势五官源裁切超出贴图范围")


def validate_pose_geometry(pose: dict, parts: dict, seen: set[str]) -> None:
    """Validate shared motion geometry independently of character facial/layer bindings."""
    part_id = pose["part"]
    if (
        not isinstance(part_id, str)
        or part_id not in parts
        or part_id in seen
        or parts[part_id]["parent"] != "body"
    ):
        raise ValueError("人物姿势素材引用无效")
    seen.add(part_id)
    stride = pose.get("stride", 32)
    if (
        isinstance(stride, bool)
        or not isinstance(stride, (int, float))
        or not math.isfinite(stride)
        or not 8 <= stride <= 96
    ):
        raise ValueError("人物姿势步长无效")
    if not pose_point(pose["waist"]):
        raise ValueError("人物姿势腰部锚点无效")
    edges = pose["edges"]
    if (
        not isinstance(edges, dict)
        or set(edges) != EDGES
        or not all(pose_point(p) for p in edges.values())
    ):
        raise ValueError("人物姿势接触边缘无效")
    limbs = pose["limbs"]
    if not isinstance(limbs, dict) or set(limbs) != LIMBS:
        raise ValueError("人物姿势缺少四肢")
    for limb in limbs.values():
        if (
            not isinstance(limb, dict)
            or not {"root", "joint", "end", "region", "limits", "bend"} <= set(limb)
            or set(limb)
            - {
                "root",
                "joint",
                "end",
                "region",
                "limits",
                "bend",
                "part",
                "segments",
                "contact",
            }
        ):
            raise ValueError("人物姿势关节无效")
        limb_part = limb.get("part")
        segments = limb.get("segments")
        if segments is not None:
            if (
                "part" in limb
                or not isinstance(segments, list)
                or len(segments) != 3
                or any(not isinstance(item, str) for item in segments)
                or len(set(segments)) != 3
                or any(
                    item not in parts or item in seen or parts[item]["parent"] != "body"
                    for item in segments
                )
            ):
                raise ValueError("人物动作骨段分件引用无效")
            seen.update(segments)
        if limb_part is not None:
            if (
                not isinstance(limb_part, str)
                or limb_part not in parts
                or limb_part in seen
                or parts[limb_part]["parent"] != "body"
            ):
                raise ValueError("人物动作分件引用无效")
            seen.add(limb_part)
        if not all(pose_point(limb[p]) for p in ("root", "joint", "end")):
            raise ValueError("人物姿势关节坐标无效")
        if "contact" in limb and (
            not pose_point(limb["contact"]) or math.dist(limb["contact"], limb["end"]) > 96
        ):
            raise ValueError("人物姿势支撑点无效")
        if any(
            not 1 <= math.dist(limb[a], limb[b]) <= 256
            for a, b in (("root", "joint"), ("joint", "end"))
        ):
            raise ValueError("人物姿势骨段长度无效")
        region = limb["region"]
        limits = limb["limits"]
        if (
            not isinstance(region, list)
            or not 3 <= len(region) <= 16
            or not all(pose_point(p) for p in region)
        ):
            raise ValueError("人物姿势蒙皮范围无效")
        if (
            not isinstance(limits, list)
            or len(limits) != 4
            or not all(
                isinstance(n, (int, float))
                and not isinstance(n, bool)
                and math.isfinite(n)
                and abs(n) <= 120
                for n in limits
            )
            or limits[0] > 0
            or limits[1] < 0
            or limits[2] > 0
            or limits[3] < 0
            or type(limb["bend"]) is not int
            or limb["bend"] not in (-1, 1)
        ):
            raise ValueError("人物姿势关节限制无效")
