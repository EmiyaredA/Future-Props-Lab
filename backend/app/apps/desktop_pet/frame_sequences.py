"""Validate complete-frame animation metadata and each outfit's authorized atlas closure."""

from __future__ import annotations

import math
import re

_NAME = re.compile(r"^[a-zA-Z0-9_-]{1,48}$")


def _number(value: object, limit: float) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and abs(value) <= limit
    )


def _point(value: object, size: list[int]) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 2
        and all(_number(n, bound) and n >= 0 for n, bound in zip(value, size, strict=True))
    )


def validate_frame_sequences(model: dict) -> set[str]:
    """Return declared safe texture IDs; the existing package owns all file budgets."""
    if "frameSequences" not in model:
        return set()
    sequences = model["frameSequences"]
    if (
        not isinstance(sequences, dict)
        or not {"version", "frameSize", "modelBox", "headLength", "clips", "transitions"}
        <= set(sequences)
        or set(sequences)
        - {"version", "frameSize", "modelBox", "headLength", "clips", "transitions"}
        or type(sequences["version"]) is not int
        or sequences["version"] != 1
    ):
        raise ValueError("完整序列帧版本或字段无效")
    size, box, head_length = (
        sequences["frameSize"],
        sequences["modelBox"],
        sequences["headLength"],
    )
    if (
        not isinstance(size, list)
        or len(size) != 2
        or any(type(n) is not int or not 1 <= n <= 4096 for n in size)
        or not isinstance(box, list)
        or len(box) != 4
        or any(not _number(n, 512) for n in box)
        or box[2] <= 0
        or box[3] <= 0
        or not _number(head_length, 512)
        or head_length <= 0
    ):
        raise ValueError("完整序列帧统一画布或头部标尺无效")
    scale = box[2] / size[0]
    if scale <= 0 or not math.isclose(scale, box[3] / size[1], rel_tol=1e-6, abs_tol=0):
        raise ValueError("完整序列帧禁止各向异性缩放")
    clips = sequences["clips"]
    if not isinstance(clips, dict) or not 1 <= len(clips) <= 64 or "idle" not in clips:
        raise ValueError("完整序列帧片段数量无效")
    textures: set[str] = set()
    total = 0
    for clip_id, clip in clips.items():
        if (
            not isinstance(clip_id, str)
            or not _NAME.fullmatch(clip_id)
            or not isinstance(clip, dict)
            or not {"frames", "loop"} <= set(clip)
            or set(clip) - {"frames", "loop", "distancePerCycle"}
            or type(clip["loop"]) is not bool
            or not isinstance(clip["frames"], list)
            or not 1 <= len(clip["frames"]) <= 128
            or (
                "distancePerCycle" in clip
                and (not _number(clip["distancePerCycle"], 512) or clip["distancePerCycle"] <= 0)
            )
        ):
            raise ValueError("完整序列帧片段定义无效")
        total += len(clip["frames"])
        if total > 2048:
            raise ValueError("完整序列帧总帧数过大")
        for frame in clip["frames"]:
            if (
                not isinstance(frame, dict)
                or not {"texture", "rect", "durationMs", "grip", "foot", "head"} <= set(frame)
                or set(frame)
                - {"texture", "rect", "durationMs", "grip", "foot", "head", "contacts", "supports"}
                or not isinstance(frame["texture"], str)
                or not _NAME.fullmatch(frame["texture"])
                or not _number(frame["durationMs"], 60000)
                or frame["durationMs"] <= 0
                or not _point(frame["grip"], size)
                or not _point(frame["foot"], size)
                or not isinstance(frame["head"], list)
                or len(frame["head"]) != 2
                or not all(_point(point, size) for point in frame["head"])
            ):
                raise ValueError("完整序列帧图片、时长或局部锚点无效")
            contacts = frame.get("contacts", {})
            if (
                not isinstance(contacts, dict)
                or set(contacts) - {"left", "right", "top", "bottom"}
                or not all(_point(point, size) for point in contacts.values())
            ):
                raise ValueError("完整序列帧四边接触锚点无效")
            supports = frame.get("supports", {})
            if (
                not isinstance(supports, dict)
                or set(supports) - {"armNear", "armFar", "legBack", "legFront"}
                or not all(_point(point, size) for point in supports.values())
            ):
                raise ValueError("完整序列帧真实支点无效")
            rect = frame["rect"]
            if (
                not isinstance(rect, list)
                or len(rect) != 4
                or any(type(n) is not int or not 0 <= n <= 4096 for n in rect)
                or rect[2:] != size
            ):
                raise ValueError("完整序列帧裁切必须保持统一尺寸")
            measured = math.dist(*frame["head"]) * scale
            if measured <= 0 or abs(measured / head_length - 1) > 0.02 + 1e-10:
                raise ValueError("完整序列帧头部比例超出统一标尺的百分之二")
            textures.add(frame["texture"])
    transitions = sequences.get("transitions", [])
    if not isinstance(transitions, list) or len(transitions) > 128:
        raise ValueError("完整序列帧过渡数量无效")
    ids: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    for transition in transitions:
        if (
            not isinstance(transition, dict)
            or set(transition) != {"id", "from", "to", "clip"}
            or not isinstance(transition["id"], str)
            or not _NAME.fullmatch(transition["id"])
            or transition["id"] in ids
            or any(
                not isinstance(transition[key], str) or transition[key] not in clips
                for key in ("from", "to", "clip")
            )
            or (transition["from"], transition["to"]) in pairs
        ):
            raise ValueError("完整序列帧过渡引用无效")
        ids.add(transition["id"])
        pairs.add((transition["from"], transition["to"]))
    return textures


def validate_frame_sequence_images(model: dict, dimensions: dict[str, tuple[int, int]]) -> None:
    """Metadata is shared across outfits; every actual atlas must contain its exact source rect."""
    sequences = model.get("frameSequences")
    if sequences is None:
        return
    for index, scheme in enumerate(model["schemes"]):
        prefix = "" if index == 0 else f"schemes/{scheme['id']}/"
        for clip in sequences["clips"].values():
            for frame in clip["frames"]:
                width, height = dimensions[f"{prefix}tex/{frame['texture']}.png"]
                x, y, w, h = frame["rect"]
                if x + w > width or y + h > height:
                    raise ValueError("完整序列帧裁切超出服饰图集实际范围")
