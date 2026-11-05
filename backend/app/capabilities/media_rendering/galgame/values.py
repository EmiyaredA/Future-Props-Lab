from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.capabilities.media_rendering.contracts import RenderCaptureFrame, RenderPlan
from app.capabilities.media_rendering.galgame.lip_sync import LipSyncSchedule
from studio.contracts.video_editor.timeline_document import VideoEditorTimelineDocument

DISTANCE_SCALE = {"far": 0.78, "medium": 1.0, "near": 1.28}


def timeline_clip(
    clip_id: str,
    track_id: str,
    kind: str,
    name: str,
    start_us: int,
    duration_us: int,
    **values: Any,
) -> dict[str, Any]:
    return {
        "id": clip_id[:64],
        "trackId": track_id,
        "kind": kind,
        "name": name[:255] or kind,
        "timelineStartUs": max(0, start_us),
        "durationUs": max(1, duration_us),
        "sourceInUs": 0,
        "transform": {
            "x": 960,
            "y": 540,
            "scaleX": 1,
            "scaleY": 1,
            "rotation": 0,
            "opacity": 1,
            "anchor": "center",
            "brightness": 1,
        },
        "keyframes": [],
        **values,
    }


def timeline_track(track_id: str, name: str, order: int, kind: str = "visual") -> dict[str, Any]:
    return {
        "id": track_id,
        "kind": kind,
        "name": name,
        "order": order,
        "locked": False,
        "hidden": False,
        "muted": False,
        "clips": [],
    }


def dialogue_speaker_ids(content: dict[str, Any] | None) -> tuple[str, ...]:
    if not content or content.get("type") != "dialogue":
        return ()
    configured = content.get("speakerIds") or []
    candidates = configured if configured else [content.get("characterId")]
    return tuple(dict.fromkeys(str(item) for item in candidates if item))


def asset_maps(document: dict[str, Any]) -> tuple[dict[str, dict], dict[str, str]]:
    assets = {item["id"]: item for item in document.get("assets", [])}
    return assets, {
        logical_id: str(item.get("fileId"))
        for logical_id, item in assets.items()
        if item.get("fileId")
    }


@dataclass(frozen=True)
class CharacterPresentation:
    expression_id: str
    expression: dict[str, Any]
    frame_file_ids: tuple[str, ...]
    playback_mode: str
    fps: int
    loop: bool
    uses_skin_override: bool = False


def character_presentation(
    characters: dict[str, dict], logical_files: dict[str, str], actor: dict[str, Any]
) -> CharacterPresentation | None:
    character = characters.get(actor.get("characterId", ""))
    if not character:
        return None
    expression_id = str(actor.get("expressionId") or character.get("defaultExpressionId") or "")
    expression = next(
        (item for item in character.get("expressions", []) if item.get("id") == expression_id),
        None,
    )
    if expression is None:
        return None
    asset_id = expression.get("assetId")
    uses_skin_override = False
    skin_id = actor.get("skinId") or character.get("defaultPortraitSkinId")
    if skin_id:
        skin = next(
            (item for item in character.get("portraitSkins", []) if item.get("id") == skin_id),
            None,
        )
        override = next(
            (
                item
                for item in (skin or {}).get("overrides", [])
                if item.get("expressionId") == expression_id
            ),
            None,
        )
        if override:
            asset_id = override.get("assetId")
            uses_skin_override = True
    sequence = expression.get("sequence") or {}
    if expression.get("renderMode") == "frameSequence" and not uses_skin_override:
        frame_file_ids = tuple(
            logical_files.get(str(frame.get("assetId") or ""), "")
            for frame in sequence.get("frames", [])
        )
        if not frame_file_ids or any(not file_id for file_id in frame_file_ids):
            raise ValueError(
                f"角色 {character.get('name') or character.get('id')} 的表情"
                f" {expression_id} 缺少序列帧素材"
            )
        return CharacterPresentation(
            expression_id=expression_id,
            expression=expression,
            frame_file_ids=frame_file_ids,
            playback_mode=str(sequence.get("playbackMode") or "timed"),
            fps=max(1, int(sequence.get("fps", 2))),
            loop=bool(sequence.get("loop", True)),
        )
    file_id = logical_files.get(str(asset_id))
    if not file_id:
        return None
    return CharacterPresentation(
        expression_id=expression_id,
        expression=expression,
        frame_file_ids=(file_id,),
        playback_mode="static",
        fps=1,
        loop=False,
        uses_skin_override=uses_skin_override,
    )


def _legacy_lip_file(
    character: dict[str, Any],
    logical_files: dict[str, str],
    authored_expression_id: str,
    frame: int,
) -> str | None:
    if frame == 0:
        return None
    match = re.match(r"^(.*-f)00[0-2]$", authored_expression_id)
    if not match:
        return None
    candidate_id = f"{match.group(1)}00{frame}"
    candidate = next(
        (
            expression
            for expression in character.get("expressions", [])
            if expression.get("id") == candidate_id
        ),
        None,
    )
    return logical_files.get(str((candidate or {}).get("assetId") or ""))


def portrait_segments(
    presentation: CharacterPresentation,
    *,
    character: dict[str, Any],
    actor: dict[str, Any],
    logical_files: dict[str, str],
    lip_schedule: LipSyncSchedule,
    source_start_us: int,
    source_end_us: int,
) -> list[tuple[int, int, str]]:
    boundaries = {source_start_us, source_end_us}
    started_us = int(actor.get("expressionStartedUs", 0))
    if presentation.playback_mode == "timed" and len(presentation.frame_file_ids) > 1:
        first_index = max(0, (source_start_us - started_us) * presentation.fps // 1_000_000)
        last_index = max(first_index, (source_end_us - started_us) * presentation.fps // 1_000_000)
        for index in range(first_index + 1, last_index + 1):
            boundary = started_us + round(index * 1_000_000 / presentation.fps)
            if source_start_us < boundary < source_end_us:
                boundaries.add(boundary)
    elif presentation.playback_mode == "lipSync" or not presentation.uses_skin_override:
        boundaries.update(
            lip_schedule.boundaries(
                str(actor.get("characterId") or ""),
                presentation.expression_id,
                source_start_us,
                source_end_us,
            )
        )

    def file_at(time_us: int) -> str:
        if presentation.playback_mode == "timed":
            elapsed = max(0, time_us - started_us)
            index = elapsed * presentation.fps // 1_000_000
            if presentation.loop:
                index %= len(presentation.frame_file_ids)
            else:
                index = min(len(presentation.frame_file_ids) - 1, index)
            return presentation.frame_file_ids[index]
        frame = lip_schedule.frame_at(
            str(actor.get("characterId") or ""), presentation.expression_id, time_us
        )
        if presentation.playback_mode == "lipSync":
            return presentation.frame_file_ids[min(frame, len(presentation.frame_file_ids) - 1)]
        return (
            _legacy_lip_file(
                character,
                logical_files,
                presentation.expression_id,
                frame,
            )
            or presentation.frame_file_ids[0]
        )

    points = sorted(boundaries)
    segments: list[tuple[int, int, str]] = []
    for start_us, end_us in zip(points, points[1:], strict=False):
        file_id = file_at(start_us)
        if segments and segments[-1][1] == start_us and segments[-1][2] == file_id:
            previous_start, _previous_end, previous_file = segments[-1]
            segments[-1] = (previous_start, end_us, previous_file)
        else:
            segments.append((start_us, end_us, file_id))
    return segments


def speaker_name(
    character: dict[str, Any] | None,
    block: dict[str, Any],
    variables: dict[str, Any] | None = None,
) -> str:
    if not character:
        return ""
    selected = block.get("displayNameId") or character.get("defaultDisplayNameId")
    display = next(
        (item for item in character.get("displayNames", []) if item.get("id") == selected), None
    )
    if display:
        source = display.get("source")
        if source == "literal":
            return str(display.get("value") or character.get("name") or "")
        if source == "variable":
            value = (variables or {}).get(str(display.get("variableId") or ""))
            if isinstance(value, str) and value:
                return value
        if source == "attribute":
            value = (character.get("attributes") or {}).get(str(display.get("attributeId") or ""))
            if isinstance(value, str) and value:
                return value
    return str(character.get("name") or "")


def content_text(block: dict[str, Any], variables: dict[str, Any] | None = None) -> str:
    content = block.get("content")
    if isinstance(content, dict) and isinstance(content.get("nodes"), list):
        parts: list[str] = []
        for node in content["nodes"]:
            if not isinstance(node, dict):
                continue
            kind = node.get("type")
            if kind in {"text", "ruby"}:
                parts.append(str(node.get("text") or ""))
            elif kind == "lineBreak":
                parts.append("\n")
            elif kind == "variable":
                parts.append(str((variables or {}).get(str(node.get("variableId") or ""), "")))
        return "".join(parts)
    text = block.get("text")
    if isinstance(text, str):
        return text
    return content if isinstance(content, str) else ""


def _stage_settings(document: dict[str, Any], character_id: str) -> dict[str, Any]:
    settings = document.get("settings") or {}
    base = dict(settings.get("characterStage") or {})
    override = (settings.get("characterStageOverrides") or {}).get(character_id) or {}
    merged = {**base, **override}
    if "positionPresets" not in override and base.get("positionPresets"):
        merged["positionPresets"] = base["positionPresets"]
    return merged


def actor_layout(
    document: dict[str, Any],
    character: dict[str, Any],
    actor: dict[str, Any],
    expression: dict[str, Any] | None,
) -> tuple[float, float, float, bool, float, float, int, str, float]:
    character_id = str(actor.get("characterId") or "")
    settings = _stage_settings(document, character_id)
    transform = actor.get("transform") or {}
    position_id = actor.get("positionId") or settings.get("defaultPositionId")
    preset = next(
        (item for item in settings.get("positionPresets", []) if item.get("id") == position_id),
        None,
    )
    if preset is None:
        builtin_x = {"left": 25, "center": 50, "right": 75}.get(str(position_id), 50)
        preset = {"x": transform.get("x", builtin_x), "y": transform.get("y", 100)}
    x = float(preset.get("x", 50)) * 19.2
    y = float(preset.get("y", 100)) * 10.8
    scale = float(transform.get("scale", settings.get("legacyDefaultScale") or 1))
    opacity = float(transform.get("opacity", 1))
    brightness = float(transform.get("brightness", 1))
    layer = int(transform.get("layer", 10))
    height = float(
        (expression or {}).get("heightPercent")
        or settings.get("defaultHeightPercent")
        or character.get("portraitHeightPercent")
        or (document.get("settings") or {})
        .get("characterStage", {})
        .get("defaultHeightPercent", 100)
    ) * DISTANCE_SCALE.get(str(actor.get("distance") or "medium"), 1)
    anchor = str(settings.get("anchor") or transform.get("anchor") or "center")
    return (
        x,
        y,
        scale,
        bool(transform.get("flipX", False)),
        opacity,
        brightness,
        layer,
        anchor,
        height,
    )


_MOTION_POINTS: dict[str, list[tuple[float, float, float, float, float]]] = {
    "breathe": [(0, 0, 0, 1, 0), (0.5, 0, -1, 1.012, 0), (1, 0, 0, 1, 0)],
    "idle": [(0, 0, 0, 1, 0), (0.5, 0, -1, 1.012, 0), (1, 0, 0, 1, 0)],
    "nod": [(0, 0, 0, 1, 0), (0.35, 0, 0.5, 1, 1), (0.7, 0, -2, 1, 0), (1, 0, 0, 1, 0)],
    "shake": [
        (0, 0, 0, 1, 0),
        (0.25, -2, 0, 1, 0),
        (0.5, 2, 0, 1, 0),
        (0.75, 0.5, 0, 1, 0),
        (1, 0, 0, 1, 0),
    ],
    "startle": [(0, 0, 0, 1, 0), (0.25, 0, -4, 1.025, 0), (0.55, 0, 1, 1, 0), (1, 0, 0, 1, 0)],
    "lean": [(0, 0, 0, 1, 0), (0.45, 4, 0, 1, 1.5), (0.7, 4, 0, 1, 1.5), (1, 0, 0, 1, 0)],
    "recoil": [(0, 0, 0, 1, 0), (0.4, -4, 0, 1, -1.5), (0.65, -4, 0, 1, -1.5), (1, 0, 0, 1, 0)],
    "step": [(0, 0, 0, 1, 0), (0.45, 5, 1, 1, 0), (0.75, 5, 1, 1, 0), (1, 0, 0, 1, 0)],
    "tug": [
        (0, 0, 0, 1, 0),
        (0.3, 6, 0, 1, 2),
        (0.55, -6, 0, 1, 0),
        (0.75, 1.5, 0, 1, 0),
        (1, 0, 0, 1, 0),
    ],
    "bounce": [(0, 0, 0, 1, 0), (0.35, 0, -5, 1, 0), (0.65, 0, 1, 1, 0), (1, 0, 0, 1, 0)],
}


def sprite_motion(animation: str, phase: float) -> tuple[float, float, float, float]:
    points = _MOTION_POINTS.get(animation, _MOTION_POINTS["breathe"])
    phase = max(0.0, min(1.0, phase))
    for index, right in enumerate(points[1:], start=1):
        if phase <= right[0]:
            left = points[index - 1]
            progress = (phase - left[0]) / max(0.000001, right[0] - left[0])
            return tuple(
                left[column] + (right[column] - left[column]) * progress for column in range(1, 5)
            )  # type: ignore[return-value]
    return points[-1][1:]


def _effect_sample_times(
    *,
    source_start_us: int,
    source_end_us: int,
    sprite: dict[str, Any] | None = None,
    camera: dict[str, Any] | None = None,
    stage_animation: dict[str, Any] | None = None,
) -> list[int]:
    points = {source_start_us, source_end_us}
    if sprite:
        duration = max(1, int(sprite.get("durationMs", 500)) * 1000)
        started = int(sprite.get("startedUs", source_start_us))
        motion = _MOTION_POINTS.get(str(sprite.get("animation")), _MOTION_POINTS["breathe"])
        first_cycle = max(0, (source_start_us - started) // duration)
        last_cycle = max(first_cycle, (source_end_us - started) // duration)
        for cycle in range(first_cycle, last_cycle + 1):
            for phase, *_values in motion:
                points.add(started + cycle * duration + round(phase * duration))
    for effect, duration_key, multiplier in (
        (camera, "durationUs", 1),
        (stage_animation, "durationMs", 1000),
    ):
        if not effect:
            continue
        started = int(effect.get("startedUs", source_start_us))
        duration = max(0, int(effect.get(duration_key, 0)) * multiplier)
        points.update((started, started + duration))
    return sorted(time_us for time_us in points if source_start_us <= time_us <= source_end_us)


def _stage_values(stage_animation: dict[str, Any] | None, absolute_us: int) -> tuple[float, float]:
    if not stage_animation:
        return 1.0, 1.0
    started = int(stage_animation.get("startedUs", absolute_us))
    duration = max(1, int(stage_animation.get("durationMs", 500)) * 1000)
    progress = max(0.0, min(1.0, (absolute_us - started) / duration))
    return 0.98 + 0.02 * progress, 0.35 + 0.65 * progress


def _set_sampled_properties(
    clip: dict[str, Any],
    samples: list[tuple[int, dict[str, float]]],
    *,
    source_start_us: int,
    interpolation: str,
) -> None:
    if not samples:
        return
    properties = tuple(samples[0][1])
    for property_name in properties:
        values = [(time_us, sample[property_name]) for time_us, sample in samples]
        if all(abs(value - values[0][1]) < 0.000001 for _time, value in values[1:]):
            clip["transform"][property_name] = values[0][1]
            continue
        clip["keyframes"] = [
            key for key in clip["keyframes"] if key.get("property") != property_name
        ]
        clip["keyframes"].extend(
            {
                "id": f"composed-{property_name}-{time_us - source_start_us}",
                "property": property_name,
                "timeUs": time_us - source_start_us,
                "value": value,
                "interpolation": interpolation,
            }
            for time_us, value in values
        )


def apply_composed_visual_motion(
    clip: dict[str, Any],
    *,
    camera: dict[str, Any] | None,
    stage_animation: dict[str, Any] | None,
    plane: str,
    source_start_us: int,
    source_end_us: int,
    sprite: dict[str, Any] | None = None,
    actor_height_px: float = 0,
) -> None:
    transform = clip["transform"]
    base_x = float(transform.get("x", 960))
    base_y = float(transform.get("y", 540))
    base_scale_x = float(transform.get("scaleX", 1))
    base_scale_y = float(transform.get("scaleY", 1))
    base_rotation = float(transform.get("rotation", 0))
    camera_applies = bool(camera and camera.get("target", "stage") in {"stage", plane})
    times = _effect_sample_times(
        source_start_us=source_start_us,
        source_end_us=source_end_us,
        sprite=sprite,
        camera=camera if camera_applies else None,
        stage_animation=stage_animation,
    )
    direction = str((sprite or {}).get("direction") or "none")
    direction_sign = -1 if direction == "left" else 1
    if direction == "towardCenter":
        direction_sign = -1 if base_x > 960 else 1
    elif direction == "awayFromCenter":
        direction_sign = 1 if base_x > 960 else -1
    intensity = float((sprite or {}).get("intensity", 1))
    samples: list[tuple[int, dict[str, float]]] = []
    for absolute_us in times:
        dx = dy = rotation = 0.0
        motion_scale = 1.0
        if sprite:
            duration = max(1, int(sprite.get("durationMs", 500)) * 1000)
            elapsed = max(0, absolute_us - int(sprite.get("startedUs", absolute_us)))
            phase = (
                (elapsed % duration) / duration
                if sprite.get("loop")
                else min(1, elapsed / duration)
            )
            dx, dy, motion_scale, rotation = sprite_motion(str(sprite.get("animation")), phase)
        x = base_x + actor_height_px * dx / 100 * intensity * direction_sign
        y = base_y + actor_height_px * dy / 100 * intensity
        scale_x = base_scale_x * (1 + (motion_scale - 1) * intensity)
        scale_y = base_scale_y * (1 + (motion_scale - 1) * intensity)
        rotation = base_rotation + rotation * intensity * direction_sign
        camera_state = camera_values(camera if camera_applies else None, absolute_us)
        x = 960 + (x - 960) * camera_state["scale"] + camera_state["x"] * 19.2
        y = 540 + (y - 540) * camera_state["scale"] + camera_state["y"] * 10.8
        scale_x *= camera_state["scale"]
        scale_y *= camera_state["scale"]
        rotation += camera_state["rotation"]
        stage_scale, _stage_opacity = _stage_values(stage_animation, absolute_us)
        x = 960 + (x - 960) * stage_scale
        y = 540 + (y - 540) * stage_scale
        samples.append(
            (
                absolute_us,
                {
                    "x": x,
                    "y": y,
                    "scaleX": scale_x * stage_scale,
                    "scaleY": scale_y * stage_scale,
                    "rotation": rotation,
                },
            )
        )
    interpolation = {
        "easeIn": "ease-in",
        "easeOut": "ease-out",
        "ease": "ease-in-out",
        "easeInOut": "ease-in-out",
    }.get(str((sprite or camera or {}).get("easing") or "easeInOut"), "linear")
    _set_sampled_properties(
        clip,
        samples,
        source_start_us=source_start_us,
        interpolation=interpolation,
    )


def apply_composed_opacity(
    clip: dict[str, Any],
    stage_animation: dict[str, Any] | None,
    transition_state: dict[str, Any] | None = None,
    *,
    source_start_us: int,
    source_end_us: int,
) -> None:
    if transition_state and not bool(transition_state.get("fade", True)):
        transition_state = None
    if not stage_animation and not transition_state:
        return
    base = float(clip["transform"].get("opacity", 1))
    points = {source_start_us, source_end_us}
    if stage_animation:
        started = int(stage_animation.get("startedUs", source_start_us))
        duration = max(1, int(stage_animation.get("durationMs", 500)) * 1000)
        points.update((started, started + duration))
    if transition_state:
        started = int(transition_state.get("transitionStartedUs", source_start_us))
        duration = max(0, int(transition_state.get("durationMs", 0)) * 1000)
        points.update((started, started + duration))

    def value_at(absolute_us: int) -> float:
        value = base * _stage_values(stage_animation, absolute_us)[1]
        if not transition_state:
            return value
        duration_us = max(0, int(transition_state.get("durationMs", 0)) * 1000)
        if duration_us == 0:
            return value
        started_us = int(transition_state.get("transitionStartedUs", source_start_us))
        progress = max(0.0, min(1.0, (absolute_us - started_us) / duration_us))
        return value * (1 - progress if transition_state.get("exiting") else progress)

    samples = [
        (time_us, value_at(time_us))
        for time_us in sorted(points)
        if source_start_us <= time_us <= source_end_us
    ]
    clip["transform"]["opacity"] = samples[0][1]
    clip["keyframes"] = [key for key in clip["keyframes"] if key.get("property") != "opacity"]
    if all(abs(value - samples[0][1]) < 0.000001 for _time, value in samples[1:]):
        return
    clip["keyframes"].extend(
        {
            "id": f"composed-opacity-{time_us - source_start_us}",
            "property": "opacity",
            "timeUs": time_us - source_start_us,
            "value": value,
            "interpolation": "ease-in-out",
        }
        for time_us, value in samples
    )


def camera_values(camera: dict[str, Any] | None, absolute_us: int) -> dict[str, float]:
    defaults = {"x": 0.0, "y": 0.0, "scale": 1.0, "rotation": 0.0}
    if not camera:
        return defaults
    target = {**defaults, **(camera.get("to") or camera)}
    source = {**defaults, **(camera.get("from") or target)}
    duration_us = max(0, int(camera.get("durationUs", 0)))
    if duration_us == 0:
        return target
    progress = max(
        0.0,
        min(1.0, (absolute_us - int(camera.get("startedUs", 0))) / duration_us),
    )
    easing = str(camera.get("easing") or "easeInOut")
    if easing == "easeIn":
        progress *= progress
    elif easing == "easeOut":
        progress = 1 - (1 - progress) ** 2
    elif easing in {"ease", "easeInOut"}:
        progress = progress * progress * (3 - 2 * progress)
    return {
        key: float(source[key]) + (float(target[key]) - float(source[key])) * progress
        for key in defaults
    }


def remap_render_plan_assets(
    plan: RenderPlan, mapping: dict[str, str], paths: dict[str, Path]
) -> RenderPlan:
    dumped = plan.document.model_dump(mode="json", by_alias=True, exclude_none=True)
    capture = plan.capture_frame
    scale = 1920 / capture.width
    for track in dumped["tracks"]:
        for clip in track["clips"]:
            if clip.get("assetId") in mapping:
                clip["assetId"] = mapping[clip["assetId"]]
            if clip.get("fontAssetId") in mapping:
                clip["fontAssetId"] = mapping[clip["fontAssetId"]]
            if track["kind"] == "visual":
                transform = clip.setdefault("transform", {})
                transform["x"] = (float(transform.get("x", 960)) - capture.x) * scale
                transform["y"] = (float(transform.get("y", 540)) - capture.y) * scale
                transform["scaleX"] = float(transform.get("scaleX", 1)) * scale
                transform["scaleY"] = float(transform.get("scaleY", 1)) * scale
                for keyframe in clip.get("keyframes", []):
                    if keyframe.get("property") == "x":
                        keyframe["value"] = (float(keyframe["value"]) - capture.x) * scale
                    elif keyframe.get("property") == "y":
                        keyframe["value"] = (float(keyframe["value"]) - capture.y) * scale
                    elif keyframe.get("property") in {"scaleX", "scaleY"}:
                        keyframe["value"] = float(keyframe["value"]) * scale
    return RenderPlan(
        document=VideoEditorTimelineDocument.model_validate(dumped),
        asset_paths=paths,
        capture_frame=RenderCaptureFrame(),
        metadata=dict(plan.metadata),
    )
