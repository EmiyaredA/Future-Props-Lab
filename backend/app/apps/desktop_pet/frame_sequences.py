"""Validate complete-frame animation metadata and each outfit's authorized atlas closure."""

from __future__ import annotations

import copy
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


def _same_cel(left: dict, right: dict) -> bool:
    """Duration may vary, but pixels and their physical registration must agree."""
    return all(
        left[key] == right[key] for key in ("texture", "rect", "grip", "foot", "head")
    ) and all(left.get(key, {}) == right.get(key, {}) for key in ("contacts", "supports"))


def _validate_distance_stages(clip: dict) -> None:
    """Optional zero-distance recovery stages retain the original frame budgets."""
    if "distanceAtFrame" not in clip:
        return
    points = clip["distanceAtFrame"]
    stride = clip.get("distancePerCycle")
    if (
        clip["loop"] is not True
        or not _number(stride, 512)
        or stride <= 0
        or not isinstance(points, list)
        or len(points) != len(clip["frames"]) + 1
        or not all(_number(n, 512) and 0 <= n <= stride for n in points)
        or points[0] != 0
        or points[-1] != stride
        or any(left > right for left, right in zip(points, points[1:], strict=False))
    ):
        raise ValueError("完整序列帧阶段累计距离无效")


def _validate_transition_branches(transition: dict, clips: dict) -> None:
    """New authored exits cover every displayed source cel; old flat links stay compatible."""
    if "branches" not in transition:
        return
    branches = transition["branches"]
    source = clips[transition["from"]]["frames"]
    target = clips[transition["to"]]["frames"][0]
    if not isinstance(branches, list) or len(branches) != len(source):
        raise ValueError("完整序列帧过渡分支必须覆盖全部来源帧")
    seen: set[int] = set()
    for branch in branches:
        if (
            not isinstance(branch, dict)
            or not {"fromFrame", "clip"} <= set(branch)
            or set(branch) - {"fromFrame", "clip", "range"}
            or type(branch["fromFrame"]) is not int
            or not 0 <= branch["fromFrame"] < len(source)
            or branch["fromFrame"] in seen
            or not isinstance(branch["clip"], str)
            or branch["clip"] not in clips
        ):
            raise ValueError("完整序列帧过渡分支索引或引用无效")
        clip = clips[branch["clip"]]
        if clip["loop"] or "distancePerCycle" in clip:
            raise ValueError("完整序列帧过渡分支必须使用独立非循环计时片段")
        start, end = 0, len(clip["frames"])
        if "range" in branch:
            selected = branch["range"]
            if (
                not isinstance(selected, list)
                or len(selected) != 2
                or any(type(index) is not int for index in selected)
                or not 0 <= selected[0] < selected[1] <= end
                or selected[1] - selected[0] < 2
            ):
                raise ValueError("完整序列帧过渡分支区间必须包含至少两帧且位于片段范围内")
            start, end = selected
        if not _same_cel(clip["frames"][start], source[branch["fromFrame"]]) or not _same_cel(
            clip["frames"][end - 1], target
        ):
            raise ValueError("完整序列帧过渡分支首尾画面与锚点登记不一致")
        seen.add(branch["fromFrame"])


def _validate_frame(frame: object, size: list[int], scale: float, head_length: float) -> None:
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
        - {"version", "frameSize", "modelBox", "headLength", "clips", "transitions", "cels"}
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
    cels = sequences.get("cels", {})
    if not isinstance(cels, dict) or len(cels) > 2048:
        raise ValueError("完整序列帧原帧登记数量无效")
    for cel_id, frame in cels.items():
        if not isinstance(cel_id, str) or not _NAME.fullmatch(cel_id):
            raise ValueError("完整序列帧原帧登记名称无效")
        _validate_frame(frame, size, scale, head_length)
        textures.add(frame["texture"])
    total = len(cels)
    resolved_clips = {}
    for clip_id, clip in clips.items():
        if (
            not isinstance(clip_id, str)
            or not _NAME.fullmatch(clip_id)
            or not isinstance(clip, dict)
            or not {"frames", "loop"} <= set(clip)
            or set(clip) - {"frames", "loop", "distancePerCycle", "distanceAtFrame"}
            or type(clip["loop"]) is not bool
            or not isinstance(clip["frames"], list)
            or not 1 <= len(clip["frames"]) <= 128
            or (
                "distancePerCycle" in clip
                and (not _number(clip["distancePerCycle"], 512) or clip["distancePerCycle"] <= 0)
            )
        ):
            raise ValueError("完整序列帧片段定义无效")
        _validate_distance_stages(clip)
        total += len(clip["frames"])
        if total > 2048:
            raise ValueError("完整序列帧总帧数过大")
        resolved = []
        for declaration in clip["frames"]:
            if isinstance(declaration, str):
                if declaration not in cels:
                    raise ValueError("完整序列帧引用了未登记的原帧")
                frame = copy.deepcopy(cels[declaration])
            else:
                frame = copy.deepcopy(declaration)
            _validate_frame(frame, size, scale, head_length)
            textures.add(frame["texture"])
            resolved.append(frame)
        # Validation never rewrites the raw upload or shares mutable cel objects.
        resolved_clips[clip_id] = {**clip, "frames": resolved}
    clips = resolved_clips
    transitions = sequences.get("transitions", [])
    if not isinstance(transitions, list) or len(transitions) > 128:
        raise ValueError("完整序列帧过渡数量无效")
    ids: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    for transition in transitions:
        if (
            not isinstance(transition, dict)
            or not {"id", "from", "to", "clip"} <= set(transition)
            or set(transition) - {"id", "from", "to", "clip", "branches"}
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
        _validate_transition_branches(transition, clips)
    # A partial range registers a pool of unrelated bridge tails, not an
    # ordinary playable clip. Actual interruption may still name it as source.
    containers = {
        branch["clip"]
        for transition in transitions
        for branch in transition.get("branches", [])
        if "range" in branch and branch["range"] != [0, len(clips[branch["clip"]]["frames"])]
    }
    if "idle" in containers or any(transition["to"] in containers for transition in transitions):
        raise ValueError("完整序列帧过渡容器不能作为待机或过渡目标")
    return textures


def validate_frame_sequence_images(model: dict, dimensions: dict[str, tuple[int, int]]) -> None:
    """Metadata is shared across outfits; every actual atlas must contain its exact source rect."""
    sequences = model.get("frameSequences")
    if sequences is None:
        return
    for index, scheme in enumerate(model["schemes"]):
        prefix = "" if index == 0 else f"schemes/{scheme['id']}/"
        cels = sequences.get("cels", {})
        frames = list(cels.values())
        frames.extend(
            cels[frame] if isinstance(frame, str) else frame
            for clip in sequences["clips"].values()
            for frame in clip["frames"]
        )
        for frame in frames:
            width, height = dimensions[f"{prefix}tex/{frame['texture']}.png"]
            x, y, w, h = frame["rect"]
            if x + w > width or y + h > height:
                raise ValueError("完整序列帧裁切超出服饰图集实际范围")
