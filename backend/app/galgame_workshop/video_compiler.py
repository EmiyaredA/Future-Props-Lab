from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.galgame_workshop.video_export_planning import _estimate_block_ms
from app.schemas.video_editor import VideoEditorTimelineDocument
from app.video_editor.render_plan import RenderCaptureFrame, RenderPlan

COMPILER_VERSION = "galgame-render-plan-v1"


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


def _clip(
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
        },
        "keyframes": [],
        **values,
    }


def _track(track_id: str, name: str, order: int, kind: str = "visual") -> dict[str, Any]:
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


def _asset_maps(document: dict[str, Any]) -> tuple[dict[str, dict], dict[str, str]]:
    assets = {item["id"]: item for item in document.get("assets", [])}
    return assets, {
        logical_id: str(item.get("fileId"))
        for logical_id, item in assets.items()
        if item.get("fileId")
    }


def _character_asset(
    characters: dict[str, dict], logical_files: dict[str, str], actor: dict[str, Any]
) -> tuple[str | None, dict[str, Any] | None]:
    character = characters.get(actor.get("characterId", ""))
    if not character:
        return None, None
    expression_id = actor.get("expressionId") or character.get("defaultExpressionId")
    expression = next(
        (item for item in character.get("expressions", []) if item.get("id") == expression_id),
        None,
    )
    if expression is None:
        return None, None
    asset_id = expression.get("assetId")
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
    return logical_files.get(str(asset_id)), expression


def _speaker_name(character: dict[str, Any] | None, block: dict[str, Any]) -> str:
    if not character:
        return ""
    selected = block.get("displayNameId") or character.get("defaultDisplayNameId")
    display = next(
        (item for item in character.get("displayNames", []) if item.get("id") == selected), None
    )
    if display and display.get("source") == "literal":
        return str(display.get("value") or character.get("name") or "")
    return str(character.get("name") or "")


def _position(actor: dict[str, Any]) -> tuple[float, float, float, bool, float, int]:
    transform = actor.get("transform") or {}
    position = actor.get("positionId")
    default_x = {"left": 27, "center": 50, "right": 73}.get(position, 50)
    x = float(transform.get("x", default_x)) * 19.2
    y_percent = float(transform.get("y", 100))
    y = y_percent * 10.8
    scale = float(transform.get("scale", 1))
    opacity = float(transform.get("opacity", 1))
    layer = int(transform.get("layer", 10))
    return x, y, scale, bool(transform.get("flipX", False)), opacity, layer


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
        self.asset_paths = asset_paths
        self.assets, self.logical_files = _asset_maps(document)
        self.characters = {item["id"]: item for item in document.get("characters", [])}
        self.scenes = {item["id"]: item for item in document.get("scenes", [])}
        self.cgs = {item["id"]: item for item in document.get("cgs", [])}
        self.tracks: dict[str, dict[str, Any]] = {}
        self.used: set[str] = set()
        self.warnings: list[CompilationIssue] = []
        self.counter = 0

    def track(self, track_id: str, name: str, order: int, kind: str = "visual") -> dict:
        if track_id not in self.tracks:
            self.tracks[track_id] = _track(track_id, name, order, kind)
        return self.tracks[track_id]

    def add(self, track_id: str, clip: dict[str, Any]) -> None:
        self.tracks[track_id]["clips"].append(clip)
        asset_id = clip.get("assetId")
        if asset_id:
            self.used.add(asset_id)

    def next_id(self, prefix: str) -> str:
        self.counter += 1
        return f"{prefix}-{self.counter}"

    def emit_state(self, state: dict[str, Any], start_us: int, end_us: int) -> None:
        duration = end_us - start_us
        if duration <= 0:
            return
        scene = self.scenes.get(state.get("sceneId", ""))
        for index, layer in enumerate((scene or {}).get("layers", [])):
            file_id = self.logical_files.get(str(layer.get("assetId")))
            if not file_id:
                continue
            track_id = f"scene-{index + 1}"
            self.track(track_id, f"场景 · {layer.get('name') or index + 1}", 100 + index)
            self.add(
                track_id,
                _clip(
                    self.next_id("scene"),
                    track_id,
                    "image",
                    str(layer.get("name") or "场景"),
                    start_us,
                    duration,
                    assetId=file_id,
                    fitMode="cover",
                ),
            )

        cg_state = state.get("cg")
        if cg_state:
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
                track_id = "cg"
                self.track(track_id, "剧情 CG", 45)
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
                self.add(track_id, clip)

        for character_id, actor in sorted(
            state.get("actors", {}).items(), key=lambda item: _position(item[1])[-1]
        ):
            file_id, expression = _character_asset(self.characters, self.logical_files, actor)
            if not file_id:
                continue
            x, y, scale, flip_x, opacity, layer = _position(actor)
            track_id = f"actor-{character_id}"
            self.track(
                track_id,
                f"角色 · {self.characters.get(character_id, {}).get('name', character_id)}",
                60 - min(20, layer),
            )
            height = (
                (expression or {}).get("heightPercent")
                or self.characters.get(character_id, {}).get("portraitHeightPercent")
                or 92
            )
            clip = _clip(
                self.next_id("actor"),
                track_id,
                "image",
                str(self.characters.get(character_id, {}).get("name") or character_id),
                start_us,
                duration,
                assetId=file_id,
                fitMode="height",
                heightPercent=float(height),
                flipX=flip_x ^ bool((expression or {}).get("flipX", False)),
            )
            clip["transform"].update(x=x, y=y, scaleX=scale, scaleY=scale, opacity=opacity)
            self.add(track_id, clip)

        active = state.get("content")
        if active and active.get("type") in {"dialogue", "narration", "storyParagraph"}:
            text = str(active.get("text") or "")
            character = self.characters.get(active.get("characterId", ""))
            name = _speaker_name(character, active) if active.get("type") == "dialogue" else ""
            style = self.document.get("presentation", {}).get("dialogueBox", {})
            panel = self.track("dialogue-panel", "对白框", 20)
            panel_clip = _clip(
                self.next_id("dialogue-panel"),
                panel["id"],
                "color",
                "对白框",
                start_us,
                duration,
                color=str(style.get("backgroundColor") or "#080e18"),
            )
            panel_clip["transform"].update(
                x=960,
                y=905,
                scaleX=1,
                scaleY=0.32,
                opacity=float(style.get("backgroundOpacity", 0.82)),
            )
            self.add(panel["id"], panel_clip)
            if name:
                name_track = self.track("speaker-name", "说话人", 10)
                name_clip = _clip(
                    self.next_id("speaker"),
                    name_track["id"],
                    "text",
                    name,
                    start_us,
                    duration,
                    text=name,
                    fontSize=32,
                    textColor=str(style.get("nameColor") or "#ffffff"),
                )
                name_clip["transform"].update(x=360, y=790)
                self.add(name_track["id"], name_clip)
            text_track = self.track("dialogue-text", "对白文字", 9)
            text_clip = _clip(
                self.next_id("dialogue"),
                text_track["id"],
                "text",
                text or "…",
                start_us,
                duration,
                text=text or "…",
                fontSize=42,
                textColor=str(style.get("textColor") or "#ffffff"),
                textMaxWidth=1420,
            )
            text_clip["transform"].update(x=960, y=900)
            self.add(text_track["id"], text_clip)

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
            self.add(track["id"], clip)

    def add_audio(
        self,
        block: dict[str, Any],
        start_us: int,
        duration_us: int,
        channel: str,
    ) -> None:
        logical_id = block.get("assetId") or block.get("voiceAssetId")
        file_id = self.logical_files.get(str(logical_id))
        if not file_id or duration_us <= 0:
            return
        track_id = f"audio-{channel}"
        labels = {"voice": "配音", "bgm": "背景音乐", "ambient": "环境音", "sfx": "音效", "master": "主音轨"}
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


def _timed_events(fragment: dict[str, Any]) -> list[tuple[int, int, str, dict[str, Any]]]:
    events: list[tuple[int, int, str, dict[str, Any]]] = []
    for index, block in enumerate(fragment.get("blocks", [])):
        if block.get("startMs") is not None and block.get("endMs") is not None:
            events.append((int(block["startMs"]), 20, "content-start", block))
            events.append((int(block["endMs"]), 10, "content-end", block))
        elif block.get("atMs") is not None:
            events.append((int(block["atMs"]), 15, "automatic", block))
    return sorted(events, key=lambda item: (item[0], item[1]))


def _sequential_events(
    fragment: dict[str, Any], asset_duration: dict[str, int]
) -> tuple[list[tuple[int, int, str, dict[str, Any]]], int]:
    events: list[tuple[int, int, str, dict[str, Any]]] = []
    cursor = 0
    automatic = {
        "scene", "showCg", "hideCg", "showCharacter", "setStageCast",
        "removeCharacter", "destroyScene", "camera", "resetCamera", "particle",
        "stageAnimation", "floatingText", "curtain", "video", "animateSprite",
        "autoPlay", "switchDialogueStyle", "portraitStyleRule", "audio",
    }
    for block in fragment.get("blocks", []):
        block_type = block.get("type")
        duration, _exact = _estimate_block_ms(block, asset_duration)
        if block_type in automatic:
            events.append((cursor, 15, "automatic", block))
            if block.get("waitForCompletion"):
                cursor += duration
            continue
        if block_type in {"dialogue", "narration", "storyParagraph", "systemMessage"}:
            duration = max(1, duration)
            events.append((cursor, 20, "content-start", block))
            events.append((cursor + duration, 10, "content-end", block))
            cursor += duration
        elif block_type == "wait":
            cursor += duration
    return sorted(events, key=lambda item: (item[0], item[1])), cursor


def _apply(state: dict[str, Any], action: str, block: dict[str, Any]) -> None:
    if action == "content-end":
        if state.get("content", {}).get("id") == block.get("id"):
            state["content"] = None
        return
    if action == "content-start":
        state["content"] = block
        if block.get("type") == "dialogue":
            character_id = block.get("characterId")
            actor = state["actors"].get(character_id, {"characterId": character_id})
            if block.get("expressionId"):
                actor["expressionId"] = block["expressionId"]
            portrait = block.get("portrait") or {}
            if portrait.get("visible", True) and portrait.get("mode") != "dialogueAvatar":
                actor.update(
                    positionId=portrait.get("positionId", actor.get("positionId")),
                    transform=portrait.get("transform", actor.get("transform", {})),
                    distance=portrait.get("distance", actor.get("distance", "medium")),
                )
                state["actors"][character_id] = actor
        return
    kind = block.get("type")
    if kind == "scene":
        state["sceneId"] = block.get("sceneId")
        if block.get("clearCharacters", True):
            state["actors"] = {}
    elif kind == "showCg":
        state["cg"] = block
    elif kind == "hideCg":
        state["cg"] = None
    elif kind == "showCharacter":
        state["actors"][block.get("characterId")] = dict(block)
    elif kind == "setStageCast":
        state["actors"] = {
            item.get("characterId"): dict(item) for item in block.get("members", [])
        }
    elif kind == "removeCharacter":
        if block.get("all"):
            state["actors"] = {}
        else:
            state["actors"].pop(block.get("characterId"), None)
    elif kind == "destroyScene":
        state.update(sceneId=None, actors={}, cg=None, content=None)
    elif kind == "curtain":
        state["curtain"] = block if block.get("action") == "show" else None
    elif kind == "video":
        state["video"] = block if block.get("action") == "play" else None


def compile_galgame_render_plan(
    document: dict[str, Any],
    payload: dict[str, Any],
    *,
    fragment_durations_ms: list[int],
    total_ms: int,
    asset_paths: dict[str, Path],
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
    asset_duration: dict[str, int] = {}
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
        events = _timed_events(fragment) if fragment.get("timeline") else []
        if not fragment.get("timeline"):
            events, inferred_ms = _sequential_events(fragment, asset_duration)
            local_end_ms = max(local_end_ms, inferred_ms)
        state: dict[str, Any] = {
            "sceneId": None,
            "actors": {},
            "cg": None,
            "curtain": None,
            "video": None,
            "content": None,
        }
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
                )
            cursor_ms = max(cursor_ms, bounded)
            if action == "end":
                break
            _apply(state, action, block)
            if action == "content-start" and block.get("type") == "dialogue":
                end = next(
                    (item[0] for item in events if item[2] == "content-end" and item[3].get("id") == block.get("id")),
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
                    )
            if action == "automatic" and block.get("type") == "audio" and block.get("action") == "play":
                start = max(bounded, local_start_ms)
                if start < local_end_ms:
                    builder.add_audio(
                        block,
                        offset_us + (start - local_start_ms) * 1000,
                        (local_end_ms - start) * 1000,
                        str(block.get("channel", "sfx")),
                    )
            if action == "automatic" and block.get("type") == "floatingText":
                start = max(bounded, local_start_ms)
                duration = min(int(block.get("durationMs", 1500)), local_end_ms - start)
                if duration > 0:
                    track = builder.track("effects-text", "视觉效果 · 浮动文字", 5)
                    clip = _clip(
                        builder.next_id("floating-text"), track["id"], "text",
                        "浮动文字", offset_us + (start - local_start_ms) * 1000,
                        duration * 1000, text=str(block.get("text") or "…"),
                        fontSize=54, textColor=str(block.get("color") or "#ffffff"),
                    )
                    clip["transform"].update(
                        x=float(block.get("x", 50)) * 19.2,
                        y=float(block.get("y", 50)) * 10.8,
                    )
                    builder.add(track["id"], clip)
        master = (fragment.get("timeline") or {}).get("masterAudio")
        if master:
            master_block = {"assetId": master.get("assetId"), "volume": master.get("volume", 100)}
            builder.add_audio(master_block, offset_us, planned_ms * 1000, "master")
        offset_us += max(1, planned_ms * 1000)

    document_out = builder.document_out(fps)
    plan = RenderPlan(
        document=document_out,
        asset_paths={key: value for key, value in asset_paths.items() if key in builder.used},
        capture_frame=frame,
        metadata={"compilerVersion": COMPILER_VERSION, "totalUs": max(1, total_ms * 1000)},
    )
    return CompilationResult(plan=plan, used_file_ids=builder.used, warnings=builder.warnings)


def remap_render_plan_assets(plan: RenderPlan, mapping: dict[str, str], paths: dict[str, Path]) -> RenderPlan:
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
