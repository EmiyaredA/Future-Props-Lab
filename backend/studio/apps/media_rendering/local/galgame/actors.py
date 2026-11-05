from __future__ import annotations

from collections.abc import Callable
from typing import Any

from studio.apps.media_rendering.local.galgame.lip_sync import LipSyncSchedule
from studio.apps.media_rendering.local.galgame.values import (
    CharacterPresentation,
    actor_layout,
    apply_composed_visual_motion,
    dialogue_speaker_ids,
    portrait_segments,
    timeline_clip,
)


def _actor_opacity(
    clip: dict[str, Any],
    actor: dict[str, Any],
    stage_animation: dict[str, Any] | None,
    *,
    base_opacity: float,
    source_start_us: int,
    source_end_us: int,
) -> None:
    points = {source_start_us, source_end_us}
    transition = actor.get("transition") or {}
    transition_us = max(0, int(transition.get("durationMs", 240)) * 1000)
    transition_fades = bool(transition.get("fade", True))
    transition_started = None
    if actor.get("exiting"):
        transition_started = int(actor.get("exitStartedUs", source_start_us))
    elif actor.get("entering"):
        transition_started = int(actor.get("enterStartedUs", source_start_us))
    if transition_started is not None and transition_fades and transition_us > 0:
        points.update((transition_started, transition_started + transition_us))
    stage_started = None
    stage_duration = 0
    if stage_animation:
        stage_started = int(stage_animation.get("startedUs", source_start_us))
        stage_duration = max(1, int(stage_animation.get("durationMs", 500)) * 1000)
        points.update((stage_started, stage_started + stage_duration))

    def value_at(absolute_us: int) -> float:
        actor_multiplier = 1.0
        if transition_started is not None and transition_fades and transition_us > 0:
            progress = max(0.0, min(1.0, (absolute_us - transition_started) / transition_us))
            actor_multiplier = 1 - progress if actor.get("exiting") else progress
        stage_multiplier = 1.0
        if stage_started is not None:
            progress = max(0.0, min(1.0, (absolute_us - stage_started) / stage_duration))
            stage_multiplier = 0.35 + 0.65 * progress
        return base_opacity * actor_multiplier * stage_multiplier

    samples = [
        (time_us, value_at(time_us))
        for time_us in sorted(points)
        if source_start_us <= time_us <= source_end_us
    ]
    clip["transform"]["opacity"] = samples[0][1]
    if all(abs(value - samples[0][1]) < 0.000001 for _time, value in samples[1:]):
        return
    clip["keyframes"] = [key for key in clip["keyframes"] if key.get("property") != "opacity"]
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


def compile_actor_clips(
    document: dict[str, Any],
    state: dict[str, Any],
    *,
    character_id: str,
    actor: dict[str, Any],
    character: dict[str, Any],
    presentation: CharacterPresentation,
    logical_files: dict[str, str],
    lip_schedule: LipSyncSchedule,
    track_id: str,
    output_start_us: int,
    source_start_us: int,
    source_end_us: int,
    next_id: Callable[[str], str],
) -> list[dict[str, Any]]:
    expression = presentation.expression
    x, y, scale, flip_x, opacity, brightness, _layer, anchor, height = actor_layout(
        document, character, actor, expression
    )
    base_brightness = brightness
    stage_style = (document.get("presentation") or {}).get("stage") or {}
    inactive = float(stage_style.get("inactiveBrightness", 0.6))
    focus_enabled = bool(stage_style.get("speakerFocusEnabled", True))
    active = state.get("content")
    active_speakers = set(dialogue_speaker_ids(active))
    target_focus = (
        inactive if focus_enabled and active_speakers and character_id not in active_speakers else 1
    )
    brightness = base_brightness * target_focus
    result: list[dict[str, Any]] = []
    segments = portrait_segments(
        presentation,
        character=character,
        actor=actor,
        logical_files=logical_files,
        lip_schedule=lip_schedule,
        source_start_us=source_start_us,
        source_end_us=source_end_us,
    )
    for segment_start_us, segment_end_us, file_id in segments:
        duration_us = segment_end_us - segment_start_us
        clip = timeline_clip(
            next_id("actor"),
            track_id,
            "image",
            str(character.get("name") or character_id),
            output_start_us + segment_start_us - source_start_us,
            duration_us,
            assetId=file_id,
            fitMode="height",
            heightPercent=height,
            flipX=flip_x ^ bool(expression.get("flipX", False)),
        )
        clip["transform"].update(
            x=x,
            y=y,
            anchor=anchor,
            scaleX=scale,
            scaleY=scale,
            opacity=opacity,
            brightness=brightness,
        )
        sprite = (state.get("spriteAnimations") or {}).get(character_id)
        apply_composed_visual_motion(
            clip,
            camera=state.get("camera"),
            stage_animation=state.get("stageAnimation"),
            plane="characters",
            source_start_us=segment_start_us,
            source_end_us=segment_end_us,
            sprite=sprite,
            actor_height_px=1080 * height / 100,
        )
        _actor_opacity(
            clip,
            actor,
            state.get("stageAnimation"),
            base_opacity=opacity,
            source_start_us=segment_start_us,
            source_end_us=segment_end_us,
        )
        focus = state.get("focusTransition") or {}
        focus_duration_us = int(stage_style.get("focusTransitionMs", 180)) * 1000
        focus_started_us = int(focus.get("startedUs", -focus_duration_us))
        if (
            focus_enabled
            and focus_duration_us > 0
            and segment_start_us < focus_started_us + focus_duration_us
        ):
            from_speakers = set(
                focus.get("fromIds") or ([focus.get("from")] if focus.get("from") else [])
            )
            to_speakers = set(focus.get("toIds") or ([focus.get("to")] if focus.get("to") else []))
            from_value = 1 if character_id in from_speakers else inactive if from_speakers else 1
            to_value = 1 if character_id in to_speakers else inactive if to_speakers else 1
            elapsed = max(0, segment_start_us - focus_started_us)
            progress = min(1, elapsed / focus_duration_us)
            initial = from_value + (to_value - from_value) * progress
            remaining = min(
                duration_us, max(0, focus_started_us + focus_duration_us - segment_start_us)
            )
            clip["transform"]["brightness"] = base_brightness * initial
            clip["keyframes"].extend(
                [
                    {
                        "id": "focus-brightness-start",
                        "property": "brightness",
                        "timeUs": 0,
                        "value": base_brightness * initial,
                        "interpolation": "ease-in-out",
                    },
                    {
                        "id": "focus-brightness-end",
                        "property": "brightness",
                        "timeUs": remaining,
                        "value": base_brightness * to_value,
                        "interpolation": "ease-in-out",
                    },
                ]
            )
        result.append(clip)
    return result
