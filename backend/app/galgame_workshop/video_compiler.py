from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.galgame_workshop.video_actor_compiler import compile_actor_clips
from app.galgame_workshop.video_compiler_events import (
    apply_event,
    sequential_events,
    timed_events,
)
from app.galgame_workshop.video_compiler_support import (
    actor_layout,
    apply_composed_opacity,
    apply_composed_visual_motion,
    character_presentation,
    content_text,
    speaker_name,
)
from app.galgame_workshop.video_compiler_support import asset_maps as _asset_maps
from app.galgame_workshop.video_compiler_support import (
    remap_render_plan_assets as remap_render_plan_assets,
)
from app.galgame_workshop.video_compiler_support import timeline_clip as _clip
from app.galgame_workshop.video_compiler_support import timeline_track as _track
from app.galgame_workshop.video_dialogue import FONT_REGULAR, render_dialogue_layer
from app.galgame_workshop.video_lip_sync import (
    AudioEnvelope,
    LipSyncSchedule,
    build_lip_sync_schedule,
)
from app.schemas.video_editor import VideoEditorTimelineDocument
from app.video_editor.render_plan import RenderCaptureFrame, RenderPlan

COMPILER_VERSION = "galgame-render-plan-v3"
FLOATING_TEXT_FONT_ASSET_ID = "galgame-floating-text-noto-sans-sc"


@dataclass
class CompilationIssue:
    code: str
    message: str
    block_id: str | None = None


@dataclass
class CompilationResult:
    plan: RenderPlan
    used_file_ids: set[str] = field(default_factory=set)
    warnings: list[CompilationIssue] = field(default_factory=list)


class _Builder:
    def __init__(
        self,
        document: dict[str, Any],
        *,
        total_us: int,
        asset_paths: dict[str, Path],
    ) -> None:
        self.document = document
        self.total_us = max(1, total_us)
        self.asset_paths = {**asset_paths, FLOATING_TEXT_FONT_ASSET_ID: FONT_REGULAR}
        self.assets, self.logical_files = _asset_maps(document)
        self.characters = {item["id"]: item for item in document.get("characters", [])}
        self.scenes = {item["id"]: item for item in document.get("scenes", [])}
        self.cgs = {item["id"]: item for item in document.get("cgs", [])}
        self.tracks: dict[str, dict[str, Any]] = {}
        self.used: set[str] = set()
        self.warnings: list[CompilationIssue] = []
        self.counter = 0
        self.lip_schedule = LipSyncSchedule(events={})

    def track(self, track_id: str, name: str, order: int, kind: str = "visual") -> dict:
        if track_id not in self.tracks:
            self.tracks[track_id] = _track(track_id, name, order, kind)
        return self.tracks[track_id]

    def add(self, track_id: str, clip: dict[str, Any]) -> None:
        clips = self.tracks[track_id]["clips"]
        previous = clips[-1] if clips else None
        if (
            previous
            and previous["timelineStartUs"] + previous["durationUs"] == clip["timelineStartUs"]
        ):
            ignored = {"id", "timelineStartUs", "durationUs"}
            comparable_previous = {k: v for k, v in previous.items() if k not in ignored}
            comparable_clip = {k: v for k, v in clip.items() if k not in ignored}
            if comparable_previous == comparable_clip:
                previous["durationUs"] += clip["durationUs"]
                return
        clips.append(clip)
        asset_id = clip.get("assetId")
        if asset_id:
            self.used.add(asset_id)
        font_asset_id = clip.get("fontAssetId")
        if font_asset_id:
            self.used.add(font_asset_id)

    def next_id(self, prefix: str) -> str:
        self.counter += 1
        return f"{prefix}-{self.counter}"

    def emit_state(
        self,
        state: dict[str, Any],
        start_us: int,
        end_us: int,
        *,
        source_start_us: int,
        source_end_us: int,
    ) -> None:
        duration = end_us - start_us
        if duration <= 0:
            return
        scene_states = [
            ("exiting", state.get("exitingScene"), 120),
            ("active", state.get("scene"), 100),
        ]
        if not state.get("scene") and state.get("sceneId"):
            scene_states.append(
                (
                    "legacy",
                    {"sceneId": state["sceneId"], "fade": False},
                    100,
                )
            )
        for role, scene_state, base_order in scene_states:
            scene = self.scenes.get((scene_state or {}).get("sceneId", ""))
            for index, layer in enumerate((scene or {}).get("layers", [])):
                file_id = self.logical_files.get(str(layer.get("assetId")))
                if not file_id:
                    continue
                track_id = f"scene-{role}-{index + 1}"
                self.track(
                    track_id,
                    f"场景 · {layer.get('name') or index + 1}",
                    base_order + index,
                )
                clip = _clip(
                    self.next_id("scene"),
                    track_id,
                    "image",
                    str(layer.get("name") or "场景"),
                    start_us,
                    duration,
                    assetId=file_id,
                    fitMode="cover",
                )
                apply_composed_visual_motion(
                    clip,
                    camera=state.get("camera"),
                    stage_animation=state.get("stageAnimation"),
                    plane="background",
                    source_start_us=source_start_us,
                    source_end_us=source_end_us,
                )
                apply_composed_opacity(
                    clip,
                    state.get("stageAnimation"),
                    scene_state,
                    source_start_us=source_start_us,
                    source_end_us=source_end_us,
                )
                self.add(track_id, clip)

        for role, cg_state, order in (
            ("exiting", state.get("exitingCg"), 46),
            ("active", state.get("cg"), 45),
        ):
            if not cg_state:
                continue
            cg = self.cgs.get(cg_state.get("cgId", ""))
            variant_id = cg_state.get("variantId") or (cg or {}).get("defaultVariantId")
            variant = next(
                (item for item in (cg or {}).get("variants", []) if item.get("id") == variant_id),
                None,
            )
            file_id = self.logical_files.get(str((variant or {}).get("assetId")))
            if file_id:
                overlay = cg_state.get("overlay") or {}
                fullscreen = cg_state.get("displayMode", "fullscreen") == "fullscreen"
                track_id = f"cg-{role}"
                self.track(track_id, "剧情 CG", order)
                clip = _clip(
                    self.next_id("cg"),
                    track_id,
                    "image",
                    str((cg or {}).get("name") or "CG"),
                    start_us,
                    duration,
                    assetId=file_id,
                    fitMode=cg_state.get("fit", "cover") if fullscreen else "contain",
                )
                if not fullscreen:
                    clip["transform"].update(
                        x=float(overlay.get("x", 50)) * 19.2,
                        y=float(overlay.get("y", 50)) * 10.8,
                        scaleX=float(overlay.get("width", 60)) / 100,
                        scaleY=float(overlay.get("width", 60)) / 100,
                        opacity=float(overlay.get("opacity", 1)),
                    )
                apply_composed_visual_motion(
                    clip,
                    camera=state.get("camera"),
                    stage_animation=state.get("stageAnimation"),
                    plane="cg",
                    source_start_us=source_start_us,
                    source_end_us=source_end_us,
                )
                apply_composed_opacity(
                    clip,
                    state.get("stageAnimation"),
                    cg_state,
                    source_start_us=source_start_us,
                    source_end_us=source_end_us,
                )
                self.add(track_id, clip)

        video_state = state.get("video")
        if video_state:
            file_id = self.logical_files.get(str(video_state.get("assetId")))
            if file_id:
                source_in_us = max(
                    0, source_start_us - int(state.get("videoStartedUs", source_start_us))
                )
                track_id = "embedded-video"
                self.track(track_id, "视频", 40)
                video_clip = _clip(
                    self.next_id("video"),
                    track_id,
                    "video",
                    "视频",
                    start_us,
                    duration,
                    assetId=file_id,
                    sourceInUs=source_in_us,
                    fitMode=str(video_state.get("fit") or "cover"),
                )
                apply_composed_visual_motion(
                    video_clip,
                    camera=None,
                    stage_animation=state.get("stageAnimation"),
                    plane="video",
                    source_start_us=source_start_us,
                    source_end_us=source_end_us,
                )
                apply_composed_opacity(
                    video_clip,
                    state.get("stageAnimation"),
                    source_start_us=source_start_us,
                    source_end_us=source_end_us,
                )
                self.add(track_id, video_clip)
                audio_track = "audio-video"
                self.track(audio_track, "视频原声", 260, "audio")
                self.add(
                    audio_track,
                    _clip(
                        self.next_id("video-audio"),
                        audio_track,
                        "audio",
                        "视频原声",
                        start_us,
                        duration,
                        assetId=file_id,
                        sourceInUs=source_in_us,
                        volume=float(video_state.get("volume", 100)) / 100,
                    ),
                )

        actor_rows: list[tuple[str, dict[str, Any], dict[str, Any], Any]] = []
        for character_id, actor in state.get("actors", {}).items():
            presentation = character_presentation(self.characters, self.logical_files, actor)
            if presentation is None:
                continue
            character = self.characters.get(character_id, {})
            actor_rows.append((character_id, actor, character, presentation))
        actor_rows.sort(
            key=lambda item: actor_layout(self.document, item[2], item[1], item[3].expression)[6]
        )
        active = state.get("content")
        for character_id, actor, character, presentation in actor_rows:
            layer = actor_layout(self.document, character, actor, presentation.expression)[6]
            track_id = f"actor-{character_id}"
            self.track(
                track_id,
                f"角色 · {character.get('name', character_id)}",
                60 - min(20, layer),
            )
            clips = compile_actor_clips(
                self.document,
                state,
                character_id=character_id,
                actor=actor,
                character=character,
                presentation=presentation,
                logical_files=self.logical_files,
                lip_schedule=self.lip_schedule,
                track_id=track_id,
                output_start_us=start_us,
                source_start_us=source_start_us,
                source_end_us=source_end_us,
                next_id=self.next_id,
            )
            for clip in clips:
                self.add(track_id, clip)

        if active and active.get("type") in {
            "dialogue",
            "narration",
            "storyParagraph",
            "systemMessage",
        }:
            variables = state.get("variables") or {}
            text = content_text(active, variables)
            character = self.characters.get(active.get("characterId", ""))
            name = (
                speaker_name(character, active, variables)
                if active.get("type") == "dialogue"
                else ""
            )
            style = self.document.get("presentation", {}).get("dialogueBox", {})
            skin_file = self.logical_files.get(str(style.get("assetId") or ""))
            asset_id, path = render_dialogue_layer(
                text=text or "…",
                name=name,
                configured_style=style,
                runtime_preset=state.get("dialoguePreset"),
                skin_path=self.asset_paths.get(skin_file or ""),
            )
            self.asset_paths[asset_id] = path
            dialogue_track = self.track("dialogue-ui", "对白 UI", 9)
            dialogue_clip = _clip(
                self.next_id("dialogue-ui"),
                dialogue_track["id"],
                "image",
                f"对白 · {name or '旁白'}",
                start_us,
                duration,
                assetId=asset_id,
                fitMode="native",
            )
            apply_composed_visual_motion(
                dialogue_clip,
                camera=None,
                stage_animation=state.get("stageAnimation"),
                plane="dialogue",
                source_start_us=source_start_us,
                source_end_us=source_end_us,
            )
            apply_composed_opacity(
                dialogue_clip,
                state.get("stageAnimation"),
                source_start_us=source_start_us,
                source_end_us=source_end_us,
            )
            self.add(dialogue_track["id"], dialogue_clip)

        curtain = state.get("curtain")
        if curtain:
            track = self.track("curtain", "幕布", 1)
            clip = _clip(
                self.next_id("curtain"),
                track["id"],
                "color",
                "幕布",
                start_us,
                duration,
                color=str(curtain.get("color") or "#000000"),
            )
            clip["transform"]["opacity"] = float(curtain.get("opacity", 1))
            apply_composed_visual_motion(
                clip,
                camera=None,
                stage_animation=state.get("stageAnimation"),
                plane="curtain",
                source_start_us=source_start_us,
                source_end_us=source_end_us,
            )
            apply_composed_opacity(
                clip,
                state.get("stageAnimation"),
                curtain,
                source_start_us=source_start_us,
                source_end_us=source_end_us,
            )
            self.add(track["id"], clip)

    def add_audio(
        self,
        block: dict[str, Any],
        start_us: int,
        duration_us: int,
        channel: str,
        *,
        source_in_us: int = 0,
    ) -> None:
        logical_id = block.get("assetId") or block.get("voiceAssetId")
        file_id = self.logical_files.get(str(logical_id))
        if not file_id or duration_us <= 0:
            return
        track_id = f"audio-{channel}"
        labels = {
            "voice": "配音",
            "bgm": "背景音乐",
            "ambient": "环境音",
            "sfx": "音效",
            "master": "主音轨",
        }
        self.track(track_id, labels.get(channel, channel), 200 + len(self.tracks), "audio")
        volume = float(block.get("voiceVolume", block.get("volume", 100))) / 100
        self.add(
            track_id,
            _clip(
                self.next_id("audio"),
                track_id,
                "audio",
                labels.get(channel, "音频"),
                start_us,
                duration_us,
                assetId=file_id,
                sourceInUs=max(0, source_in_us),
                sourceLoop=bool(block.get("loop", False)),
                volume=volume,
            ),
        )

    def document_out(self, fps: int) -> VideoEditorTimelineDocument:
        tracks = sorted(self.tracks.values(), key=lambda item: item["order"])
        for index, track in enumerate(tracks):
            track["order"] = index
            track["clips"].sort(key=lambda item: (item["timelineStartUs"], item["id"]))
        return VideoEditorTimelineDocument.model_validate(
            {
                "schemaVersion": "1.0",
                "settings": {
                    "width": 1920,
                    "height": 1080,
                    "fps": fps,
                    "backgroundColor": "#000000",
                },
                "tracks": tracks,
            }
        )


def compile_galgame_render_plan(
    document: dict[str, Any],
    payload: dict[str, Any],
    *,
    fragment_durations_ms: list[int],
    total_ms: int,
    asset_paths: dict[str, Path],
    asset_duration_ms: dict[str, int] | None = None,
    audio_envelopes: dict[str, AudioEnvelope] | None = None,
) -> CompilationResult:
    preset = str(payload.get("preset", "1080p30"))
    fps = 60 if preset.endswith("60") else 30
    capture = payload.get("captureFrame") or {}
    frame = RenderCaptureFrame(
        x=int(capture.get("x", 0)),
        y=int(capture.get("y", 0)),
        width=int(capture.get("width", 1920)),
        height=int(capture.get("height", 1080)),
    )
    builder = _Builder(document, total_us=max(1, total_ms * 1000), asset_paths=asset_paths)
    fragments = {
        item["id"]: item
        for chapter in document.get("chapters", [])
        for item in chapter.get("fragments", [])
    }
    selected_ids = list(payload.get("resolvedFragmentIds") or payload.get("fragmentIds") or [])
    offset_us = 0
    asset_duration = asset_duration_ms or {}
    state: dict[str, Any] = {
        "sceneId": None,
        "scene": None,
        "exitingScene": None,
        "actors": {},
        "cg": None,
        "exitingCg": None,
        "curtain": None,
        "video": None,
        "videoStartedUs": 0,
        "camera": None,
        "content": None,
        "contentStartedUs": None,
        "spriteAnimations": {},
        "stageAnimation": None,
        "dialoguePreset": None,
        "focusTransition": {},
        "lastSpeaker": None,
        "variables": {
            str(item.get("id")): item.get("defaultValue") for item in document.get("variables", [])
        },
    }
    for index, fragment_id in enumerate(selected_ids):
        fragment = fragments.get(fragment_id)
        if fragment is None:
            continue
        planned_ms = (
            fragment_durations_ms[index]
            if index < len(fragment_durations_ms)
            else int((fragment.get("timeline") or {}).get("durationMs", 0))
        )
        clip_range = payload.get("clipRange") if payload.get("scope") == "clip" else None
        local_start_ms = int((clip_range or {}).get("startMs", 0))
        local_end_ms = int((clip_range or {}).get("endMs", planned_ms + local_start_ms))
        events = timed_events(fragment) if fragment.get("timeline") else []
        if not fragment.get("timeline"):
            events, inferred_ms = sequential_events(fragment, asset_duration)
            local_end_ms = max(local_end_ms, inferred_ms)
        builder.lip_schedule = build_lip_sync_schedule(
            document,
            fragment,
            events,
            duration_us=max(0, local_end_ms * 1000),
            logical_files=builder.logical_files,
            envelopes=audio_envelopes or {},
        )
        cursor_ms = 0
        for time_ms, _priority, action, block in [*events, (local_end_ms, 99, "end", {})]:
            bounded = min(local_end_ms, max(0, time_ms))
            visible_start = max(cursor_ms, local_start_ms)
            visible_end = min(bounded, local_end_ms)
            if visible_end > visible_start:
                builder.emit_state(
                    state,
                    offset_us + (visible_start - local_start_ms) * 1000,
                    offset_us + (visible_end - local_start_ms) * 1000,
                    source_start_us=visible_start * 1000,
                    source_end_us=visible_end * 1000,
                )
            cursor_ms = max(cursor_ms, bounded)
            if action == "end":
                break
            apply_event(
                state,
                action,
                block,
                absolute_us=bounded * 1000,
            )
            master = (fragment.get("timeline") or {}).get("masterAudio")
            if action == "content-start" and block.get("type") == "dialogue" and not master:
                end = next(
                    (
                        item[0]
                        for item in events
                        if item[2] == "content-end" and item[3].get("id") == block.get("id")
                    ),
                    bounded + 1000,
                )
                start = max(bounded, local_start_ms)
                stop = min(end, local_end_ms)
                if stop > start and block.get("voiceAssetId"):
                    builder.add_audio(
                        block,
                        offset_us + (start - local_start_ms) * 1000,
                        (stop - start) * 1000,
                        "voice",
                        source_in_us=(start - bounded) * 1000,
                    )
            if (
                action == "automatic"
                and block.get("type") == "audio"
                and block.get("action") == "play"
            ):
                start = max(bounded, local_start_ms)
                stop = next(
                    (
                        item[0]
                        for item in events
                        if item[0] > bounded
                        and item[2] == "automatic"
                        and item[3].get("type") == "audio"
                        and item[3].get("channel") == block.get("channel")
                    ),
                    local_end_ms,
                )
                logical_duration = asset_duration.get(str(block.get("assetId")))
                if not block.get("loop") and logical_duration:
                    stop = min(stop, bounded + logical_duration)
                stop = min(stop, local_end_ms)
                if start < stop:
                    builder.add_audio(
                        block,
                        offset_us + (start - local_start_ms) * 1000,
                        (stop - start) * 1000,
                        str(block.get("channel", "sfx")),
                        source_in_us=(
                            (start - bounded) % logical_duration
                            if block.get("loop") and logical_duration
                            else start - bounded
                        )
                        * 1000,
                    )
            if action == "automatic" and block.get("type") == "floatingText":
                start = max(bounded, local_start_ms)
                floating_end = bounded + int(block.get("durationMs", 1500))
                duration = min(floating_end, local_end_ms) - start
                if duration > 0:
                    is_long_form = duration >= 5000 or len(str(block.get("text") or "")) >= 80
                    # Lower track orders render on top. Keep floating text above a
                    # fullscreen curtain so interstitial captions remain visible.
                    track = builder.track("effects-text", "视觉效果 · 浮动文字", 0)
                    clip = _clip(
                        builder.next_id("floating-text"),
                        track["id"],
                        "text",
                        "浮动文字",
                        offset_us + (start - local_start_ms) * 1000,
                        duration * 1000,
                        text=str(block.get("text") or "…"),
                        fontAssetId=FLOATING_TEXT_FONT_ASSET_ID,
                        fontSize=34 if is_long_form else 54,
                        textMaxWidth=1000 if is_long_form else None,
                        textColor=str(block.get("color") or "#ffffff"),
                    )
                    clip["transform"].update(
                        x=float(block.get("x", 50)) * 19.2,
                        y=float(block.get("y", 50)) * 10.8,
                    )
                    source_start_us = start * 1000
                    source_end_us = (start + duration) * 1000
                    apply_composed_visual_motion(
                        clip,
                        camera=None,
                        stage_animation=state.get("stageAnimation"),
                        plane="effects",
                        source_start_us=source_start_us,
                        source_end_us=source_end_us,
                    )
                    apply_composed_opacity(
                        clip,
                        state.get("stageAnimation"),
                        source_start_us=source_start_us,
                        source_end_us=source_end_us,
                    )
                    builder.add(track["id"], clip)
        master = (fragment.get("timeline") or {}).get("masterAudio")
        output_fragment_ms = max(1, local_end_ms - local_start_ms)
        if master:
            master_block = {"assetId": master.get("assetId"), "volume": master.get("volume", 100)}
            builder.add_audio(
                master_block,
                offset_us,
                output_fragment_ms * 1000,
                "master",
                source_in_us=local_start_ms * 1000,
            )
        offset_us += output_fragment_ms * 1000

    document_out = builder.document_out(fps)
    plan = RenderPlan(
        document=document_out,
        asset_paths={
            key: value for key, value in builder.asset_paths.items() if key in builder.used
        },
        capture_frame=frame,
        metadata={"compilerVersion": COMPILER_VERSION, "totalUs": max(1, total_ms * 1000)},
    )
    return CompilationResult(plan=plan, used_file_ids=builder.used, warnings=builder.warnings)
