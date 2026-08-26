import io
from pathlib import Path

from PIL import Image

from app.galgame_workshop.video_compiler import (
    FLOATING_TEXT_FONT_ASSET_ID,
    compile_galgame_render_plan,
)
from app.galgame_workshop.video_dialogue import FONT_REGULAR
from app.galgame_workshop.video_lip_sync import AudioEnvelope
from app.video_editor.frames import render_plan_frame


def test_story_compiler_builds_layered_timeline_and_capture_frame() -> None:
    document = {
        "assets": [
            {"id": "bg", "fileId": "file-bg"},
            {"id": "face", "fileId": "file-face"},
            {"id": "voice", "fileId": "file-voice"},
        ],
        "scenes": [{"id": "lab", "layers": [{"name": "实验室", "assetId": "bg"}]}],
        "cgs": [],
        "characters": [
            {
                "id": "hero",
                "name": "主角",
                "defaultExpressionId": "normal",
                "expressions": [{"id": "normal", "assetId": "face"}],
                "displayNames": [],
            }
        ],
        "presentation": {"dialogueBox": {}},
        "chapters": [
            {
                "id": "chapter",
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {"durationMs": 2000},
                        "blocks": [
                            {"id": "scene", "type": "scene", "sceneId": "lab", "atMs": 0},
                            {
                                "id": "camera",
                                "type": "camera",
                                "target": "background",
                                "effect": "move",
                                "x": 2,
                                "y": -1,
                                "scale": 1.1,
                                "rotation": 0,
                                "durationMs": 1000,
                                "easing": "linear",
                                "atMs": 0,
                            },
                            {
                                "id": "actor",
                                "type": "showCharacter",
                                "characterId": "hero",
                                "positionId": "center",
                                "atMs": 0,
                            },
                            {
                                "id": "line",
                                "type": "dialogue",
                                "characterId": "hero",
                                "text": "确定性对白",
                                "voiceAssetId": "voice",
                                "startMs": 0,
                                "endMs": 2000,
                            },
                        ],
                    }
                ],
            }
        ],
    }
    result = compile_galgame_render_plan(
        document,
        {
            "preset": "720p60",
            "resolvedFragmentIds": ["main"],
            "captureFrame": {"x": 160, "y": 90, "width": 1600, "height": 900},
        },
        fragment_durations_ms=[2000],
        total_ms=2000,
        asset_paths={
            "file-bg": Path("/tmp/bg.png"),
            "file-face": Path("/tmp/face.png"),
            "file-voice": Path("/tmp/voice.wav"),
        },
    )
    tracks = {track.name: track for track in result.plan.document.tracks}
    assert result.plan.document.settings.fps == 60
    assert result.plan.capture_frame.width == 1600
    assert {"场景 · 实验室", "角色 · 主角", "对白 UI", "配音"}.issubset(tracks)
    assert {"file-bg", "file-face", "file-voice"}.issubset(result.used_file_ids)
    dialogue = tracks["对白 UI"].clips[0]
    assert dialogue.asset_id is not None
    assert result.plan.asset_paths[dialogue.asset_id].is_file()
    scene_clips = tracks["场景 · 实验室"].clips
    assert scene_clips[0].duration_us == 1_000_000
    assert any(key.property == "scaleX" and key.value == 1.1 for key in scene_clips[0].keyframes)
    assert scene_clips[-1].transform.x == 998.4

    clipped = compile_galgame_render_plan(
        document,
        {
            "scope": "clip",
            "clipRange": {"fragmentId": "main", "startMs": 1500, "endMs": 2000},
            "preset": "720p30",
            "resolvedFragmentIds": ["main"],
        },
        fragment_durations_ms=[500],
        total_ms=500,
        asset_paths={
            "file-bg": Path("/tmp/bg.png"),
            "file-face": Path("/tmp/face.png"),
            "file-voice": Path("/tmp/voice.wav"),
        },
    )
    clipped_scene = next(
        track for track in clipped.plan.document.tracks if track.name == "场景 · 实验室"
    ).clips[0]
    assert clipped_scene.timeline_start_us == 0
    assert clipped_scene.transform.x == 998.4
    assert clipped_scene.transform.scale_x == 1.1
    assert not any(key.id.startswith("camera-") for key in clipped_scene.keyframes)

    fragment = document["chapters"][0]["fragments"][0]
    fragment.pop("timeline")
    fragment["blocks"] = [fragment["blocks"][-1]]
    sequential = compile_galgame_render_plan(
        document,
        {"preset": "1080p30", "resolvedFragmentIds": ["main"]},
        fragment_durations_ms=[5400],
        total_ms=5400,
        asset_paths={"file-voice": Path("/tmp/voice.wav")},
        asset_duration_ms={"voice": 5000},
    )
    voice_track = next(track for track in sequential.plan.document.tracks if track.name == "配音")
    assert voice_track.clips[0].duration_us == 5_400_000


def test_long_floating_text_uses_bundled_chinese_font() -> None:
    document = {
        "assets": [],
        "scenes": [],
        "cgs": [],
        "characters": [],
        "presentation": {"dialogueBox": {}},
        "chapters": [
            {
                "id": "chapter",
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {"durationMs": 10_000},
                        "blocks": [
                            {
                                "id": "declaration",
                                "type": "floatingText",
                                "atMs": 0,
                                "text": "源剧情：自由粒子的逃逸\n本视频为自制版本",
                                "durationMs": 10_000,
                            }
                        ],
                    }
                ],
            }
        ],
    }

    result = compile_galgame_render_plan(
        document,
        {"preset": "1080p30", "resolvedFragmentIds": ["main"]},
        fragment_durations_ms=[10_000],
        total_ms=10_000,
        asset_paths={},
    )

    text_clip = next(
        clip for track in result.plan.document.tracks for clip in track.clips if clip.kind == "text"
    )
    assert text_clip.font_asset_id == FLOATING_TEXT_FONT_ASSET_ID
    assert text_clip.font_size == 34
    assert text_clip.text_max_width == 1000
    assert result.plan.asset_paths[FLOATING_TEXT_FONT_ASSET_ID] == FONT_REGULAR


def test_floating_text_renders_above_fullscreen_curtain() -> None:
    document = {
        "assets": [],
        "scenes": [],
        "cgs": [],
        "characters": [],
        "presentation": {"dialogueBox": {}},
        "chapters": [
            {
                "id": "chapter",
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {"durationMs": 4_000},
                        "blocks": [
                            {
                                "id": "curtain-show",
                                "type": "curtain",
                                "atMs": 0,
                                "action": "show",
                                "mode": "fullscreen",
                                "durationMs": 0,
                                "color": "#000000",
                                "opacity": 1,
                            },
                            {
                                "id": "interstitial-copy",
                                "type": "floatingText",
                                "atMs": 0,
                                "text": "玲羽和众人解释一番过后......",
                                "durationMs": 4_000,
                            },
                        ],
                    }
                ],
            }
        ],
    }

    result = compile_galgame_render_plan(
        document,
        {"preset": "1080p30", "resolvedFragmentIds": ["main"]},
        fragment_durations_ms=[4_000],
        total_ms=4_000,
        asset_paths={},
    )

    tracks = {track.id: track for track in result.plan.document.tracks}
    assert tracks["effects-text"].order < tracks["curtain"].order


def test_clip_export_does_not_restore_expired_floating_text() -> None:
    document = {
        "assets": [],
        "scenes": [],
        "cgs": [],
        "characters": [],
        "presentation": {"dialogueBox": {}},
        "chapters": [
            {
                "id": "chapter",
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {"durationMs": 20_000},
                        "blocks": [
                            {
                                "id": "declaration",
                                "type": "floatingText",
                                "atMs": 500,
                                "text": "只在开头显示",
                                "durationMs": 10_000,
                            }
                        ],
                    }
                ],
            }
        ],
    }

    result = compile_galgame_render_plan(
        document,
        {
            "scope": "clip",
            "clipRange": {"fragmentId": "main", "startMs": 12_000, "endMs": 15_000},
            "preset": "1080p30",
            "resolvedFragmentIds": ["main"],
        },
        fragment_durations_ms=[3_000],
        total_ms=3_000,
        asset_paths={},
    )

    assert not any(
        clip.kind == "text" for track in result.plan.document.tracks for clip in track.clips
    )


def test_clip_export_restores_active_story_cg() -> None:
    document = {
        "assets": [{"id": "cg-asset", "fileId": "file-cg"}],
        "scenes": [],
        "cgs": [
            {
                "id": "cg",
                "name": "关键剧情",
                "variants": [{"id": "cg-default", "assetId": "cg-asset"}],
                "defaultVariantId": "cg-default",
            }
        ],
        "characters": [],
        "presentation": {"dialogueBox": {}},
        "chapters": [
            {
                "id": "chapter",
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {"durationMs": 1000},
                        "blocks": [
                            {
                                "id": "show",
                                "type": "showCg",
                                "atMs": 200,
                                "cgId": "cg",
                                "variantId": "cg-default",
                                "displayMode": "fullscreen",
                                "fit": "cover",
                            },
                            {
                                "id": "hide",
                                "type": "hideCg",
                                "atMs": 800,
                                "transition": {"durationMs": 200, "fade": True},
                            },
                        ],
                    }
                ],
            }
        ],
    }
    result = compile_galgame_render_plan(
        document,
        {
            "scope": "clip",
            "clipRange": {"fragmentId": "main", "startMs": 500, "endMs": 1000},
            "preset": "1080p30",
            "resolvedFragmentIds": ["main"],
        },
        fragment_durations_ms=[500],
        total_ms=500,
        asset_paths={"file-cg": Path("/tmp/cg.png")},
    )
    cg_tracks = [track for track in result.plan.document.tracks if track.name == "剧情 CG"]
    cg_clips = [clip for track in cg_tracks for clip in track.clips]
    assert {clip.asset_id for clip in cg_clips} == {"file-cg"}
    assert min(clip.timeline_start_us for clip in cg_clips) == 0
    assert max(clip.timeline_start_us + clip.duration_us for clip in cg_clips) == 500_000
    assert "file-cg" in result.used_file_ids


def test_scene_and_cg_changes_compile_as_single_crossfades() -> None:
    document = {
        "assets": [
            {"id": "bg-one", "fileId": "file-bg-one"},
            {"id": "bg-two", "fileId": "file-bg-two"},
            {"id": "cg-one-asset", "fileId": "file-cg-one"},
            {"id": "cg-two-asset", "fileId": "file-cg-two"},
        ],
        "scenes": [
            {"id": "scene-one", "layers": [{"name": "一", "assetId": "bg-one"}]},
            {"id": "scene-two", "layers": [{"name": "二", "assetId": "bg-two"}]},
        ],
        "cgs": [
            {
                "id": "cg-one",
                "name": "CG 一",
                "variants": [{"id": "cg-one-default", "assetId": "cg-one-asset"}],
                "defaultVariantId": "cg-one-default",
            },
            {
                "id": "cg-two",
                "name": "CG 二",
                "variants": [{"id": "cg-two-default", "assetId": "cg-two-asset"}],
                "defaultVariantId": "cg-two-default",
            },
        ],
        "characters": [],
        "presentation": {"dialogueBox": {}},
        "chapters": [
            {
                "id": "chapter",
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {"durationMs": 5000},
                        "blocks": [
                            {
                                "id": "scene-one",
                                "type": "scene",
                                "sceneId": "scene-one",
                                "atMs": 0,
                                "transition": {"durationMs": 0, "fade": False},
                            },
                            {
                                "id": "scene-two",
                                "type": "scene",
                                "sceneId": "scene-two",
                                "atMs": 1000,
                                "transition": {"durationMs": 350, "fade": True},
                            },
                            {
                                "id": "show-one",
                                "type": "showCg",
                                "cgId": "cg-one",
                                "atMs": 2000,
                                "transition": {"durationMs": 450, "fade": True},
                            },
                            {
                                "id": "show-two",
                                "type": "showCg",
                                "cgId": "cg-two",
                                "atMs": 3000,
                                "transition": {"durationMs": 450, "fade": True},
                            },
                            {
                                "id": "hide-two",
                                "type": "hideCg",
                                "atMs": 4000,
                                "transition": {"durationMs": 450, "fade": True},
                            },
                        ],
                    }
                ],
            }
        ],
    }
    result = compile_galgame_render_plan(
        document,
        {"preset": "1080p30", "resolvedFragmentIds": ["main"]},
        fragment_durations_ms=[5000],
        total_ms=5000,
        asset_paths={
            "file-bg-one": Path("/tmp/bg-one.png"),
            "file-bg-two": Path("/tmp/bg-two.png"),
            "file-cg-one": Path("/tmp/cg-one.png"),
            "file-cg-two": Path("/tmp/cg-two.png"),
        },
    )
    tracks = {track.id: track for track in result.plan.document.tracks}
    assert "scene-active-1" in tracks
    assert "scene-exiting-1" in tracks
    assert "cg-active" in tracks
    assert "cg-exiting" in tracks
    assert any(clip.asset_id == "file-cg-two" for clip in tracks["cg-active"].clips)
    assert any(clip.asset_id == "file-cg-one" for clip in tracks["cg-exiting"].clips)
    assert not any(track.id.startswith("curtain") for track in tracks.values())


def test_clip_export_replays_stage_and_trims_master_audio_without_line_voice() -> None:
    document = {
        "assets": [
            {"id": "face", "fileId": "file-face"},
            {"id": "voice", "fileId": "file-voice"},
            {"id": "master", "fileId": "file-master"},
        ],
        "settings": {
            "characterStage": {
                "anchor": "bottomCenter",
                "defaultPositionId": "position-center",
                "defaultHeightPercent": 100,
                "positionPresets": [
                    {"id": "position-left", "x": 25, "y": 100},
                    {"id": "position-center", "x": 50, "y": 100},
                ],
            }
        },
        "presentation": {
            "dialogueBox": {"preset": "classicGradient"},
            "stage": {"speakerFocusEnabled": True, "inactiveBrightness": 0.4},
        },
        "scenes": [],
        "cgs": [],
        "characters": [
            {
                "id": "hero",
                "name": "大御门",
                "defaultExpressionId": "normal",
                "expressions": [{"id": "normal", "assetId": "face"}],
                "displayNames": [],
            }
        ],
        "chapters": [
            {
                "id": "chapter",
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {
                            "durationMs": 2000,
                            "masterAudio": {"assetId": "master", "volume": 100},
                        },
                        "blocks": [
                            {
                                "id": "line",
                                "type": "dialogue",
                                "characterId": "hero",
                                "text": "快道歉，你快对我的纯洁道歉！",
                                "voiceAssetId": "voice",
                                "portrait": {
                                    "mode": "stage",
                                    "visible": True,
                                    "positionId": "position-left",
                                    "distance": "near",
                                    "keepAfter": False,
                                },
                                "startMs": 0,
                                "endMs": 1000,
                            },
                            {
                                "id": "startle",
                                "type": "animateSprite",
                                "characterId": "hero",
                                "animation": "startle",
                                "durationMs": 520,
                                "intensity": 1,
                                "atMs": 80,
                            },
                        ],
                    }
                ],
            }
        ],
    }
    result = compile_galgame_render_plan(
        document,
        {
            "scope": "clip",
            "clipRange": {"fragmentId": "main", "startMs": 500, "endMs": 1500},
            "preset": "720p30",
            "resolvedFragmentIds": ["main"],
        },
        fragment_durations_ms=[1000],
        total_ms=1000,
        asset_paths={
            "file-face": Path("/tmp/face.png"),
            "file-voice": Path("/tmp/voice.wav"),
            "file-master": Path("/tmp/master.wav"),
        },
    )
    tracks = {track.name: track for track in result.plan.document.tracks}
    actor_clips = tracks["角色 · 大御门"].clips
    actor = actor_clips[0]
    assert actor.timeline_start_us == 0
    assert sum(clip.duration_us for clip in actor_clips) == 740_000
    assert actor.transform.anchor == "bottomCenter"
    assert actor.transform.x == 480
    assert actor.transform.y == 1080
    assert actor.height_percent == 128
    assert any(key.time_us == 0 and key.property == "y" for key in actor.keyframes)
    exit_clip = actor_clips[-1]
    assert any(key.property == "opacity" and key.value == 0 for key in exit_clip.keyframes)
    assert "配音" not in tracks
    master = tracks["主音轨"].clips[0]
    assert master.timeline_start_us == 0
    assert master.source_in_us == 500_000
    assert master.duration_us == 1_000_000
    assert len(tracks["对白 UI"].clips) == 1
    assert sum(clip.duration_us for clip in tracks["对白 UI"].clips) == 500_000


def test_curtain_transitions_are_continuous_absolute_fades() -> None:
    document = {
        "assets": [],
        "scenes": [],
        "cgs": [],
        "characters": [],
        "chapters": [
            {
                "id": "chapter",
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {"durationMs": 1000},
                        "blocks": [
                            {
                                "id": "close",
                                "type": "curtain",
                                "action": "show",
                                "color": "#000000",
                                "opacity": 1,
                                "durationMs": 500,
                                "atMs": 0,
                            },
                            {
                                "id": "open",
                                "type": "curtain",
                                "action": "hide",
                                "color": "#000000",
                                "opacity": 1,
                                "durationMs": 500,
                                "atMs": 500,
                            },
                        ],
                    }
                ],
            }
        ],
    }
    result = compile_galgame_render_plan(
        document,
        {"preset": "720p30", "resolvedFragmentIds": ["main"]},
        fragment_durations_ms=[1000],
        total_ms=1000,
        asset_paths={},
    )
    clips = next(track for track in result.plan.document.tracks if track.name == "幕布").clips
    assert len(clips) == 2
    assert [key.value for key in clips[0].keyframes if key.property == "opacity"] == [0, 1]
    assert [key.value for key in clips[1].keyframes if key.property == "opacity"] == [1, 0]


def test_lip_sync_sequence_restores_mid_clip_audio_phase() -> None:
    document = {
        "assets": [
            {"id": "closed", "fileId": "file-closed"},
            {"id": "half", "fileId": "file-half"},
            {"id": "open", "fileId": "file-open"},
            {"id": "master", "fileId": "file-master"},
        ],
        "scenes": [],
        "cgs": [],
        "characters": [
            {
                "id": "hero",
                "name": "主角",
                "defaultExpressionId": "talk",
                "expressions": [
                    {
                        "id": "talk",
                        "assetId": "closed",
                        "renderMode": "frameSequence",
                        "sequence": {
                            "playbackMode": "lipSync",
                            "fps": 15,
                            "loop": True,
                            "frames": [
                                {"id": "closed", "assetId": "closed"},
                                {"id": "half", "assetId": "half"},
                                {"id": "open", "assetId": "open"},
                            ],
                        },
                    }
                ],
                "displayNames": [],
            }
        ],
        "presentation": {"stage": {"lipSyncEnabled": True}, "dialogueBox": {}},
        "chapters": [
            {
                "id": "chapter",
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {
                            "durationMs": 500,
                            "masterAudio": {"assetId": "master", "volume": 100},
                        },
                        "blocks": [
                            {
                                "id": "line",
                                "type": "dialogue",
                                "characterId": "hero",
                                "expressionId": "talk",
                                "text": "口型测试",
                                "startMs": 0,
                                "endMs": 500,
                            }
                        ],
                    }
                ],
            }
        ],
    }
    full = compile_galgame_render_plan(
        document,
        {
            "scope": "clip",
            "clipRange": {"fragmentId": "main", "startMs": 0, "endMs": 400},
            "preset": "1080p30",
            "resolvedFragmentIds": ["main"],
        },
        fragment_durations_ms=[400],
        total_ms=400,
        asset_paths={
            "file-closed": Path("/tmp/closed.png"),
            "file-half": Path("/tmp/half.png"),
            "file-open": Path("/tmp/open.png"),
            "file-master": Path("/tmp/master.wav"),
        },
        audio_envelopes={
            "file-master": AudioEnvelope(
                hop_us=33_334,
                levels_db=(-100, -100, *([-20] * 10), -100, -100, -100),
            )
        },
    )
    result = compile_galgame_render_plan(
        document,
        {
            "scope": "clip",
            "clipRange": {"fragmentId": "main", "startMs": 150, "endMs": 400},
            "preset": "1080p30",
            "resolvedFragmentIds": ["main"],
        },
        fragment_durations_ms=[250],
        total_ms=250,
        asset_paths={
            "file-closed": Path("/tmp/closed.png"),
            "file-half": Path("/tmp/half.png"),
            "file-open": Path("/tmp/open.png"),
            "file-master": Path("/tmp/master.wav"),
        },
        audio_envelopes={
            "file-master": AudioEnvelope(
                hop_us=33_334,
                levels_db=(-100, -100, *([-20] * 10), -100, -100, -100),
            )
        },
    )
    full_actor = next(track for track in full.plan.document.tracks if track.name == "角色 · 主角")
    full_clip_at_cut = next(
        clip
        for clip in full_actor.clips
        if clip.timeline_start_us <= 150_000 < clip.timeline_start_us + clip.duration_us
    )
    actor = next(track for track in result.plan.document.tracks if track.name == "角色 · 主角")
    assert actor.clips[0].asset_id == full_clip_at_cut.asset_id
    cursor_us = 0
    for clip in actor.clips:
        assert clip.timeline_start_us == cursor_us
        cursor_us += clip.duration_us
    assert cursor_us == 250_000
    assert {clip.asset_id for clip in actor.clips}.issubset(result.used_file_ids)


def test_timed_sequence_uses_expression_absolute_phase() -> None:
    document = {
        "assets": [
            {"id": "one", "fileId": "file-one"},
            {"id": "two", "fileId": "file-two"},
            {"id": "three", "fileId": "file-three"},
        ],
        "scenes": [],
        "cgs": [],
        "characters": [
            {
                "id": "hero",
                "name": "主角",
                "defaultExpressionId": "blink",
                "expressions": [
                    {
                        "id": "blink",
                        "assetId": "one",
                        "renderMode": "frameSequence",
                        "sequence": {
                            "playbackMode": "timed",
                            "fps": 2,
                            "loop": False,
                            "frames": [
                                {"id": "one", "assetId": "one"},
                                {"id": "two", "assetId": "two"},
                                {"id": "three", "assetId": "three"},
                            ],
                        },
                    }
                ],
                "displayNames": [],
            }
        ],
        "presentation": {"dialogueBox": {}},
        "chapters": [
            {
                "id": "chapter",
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {"durationMs": 1400},
                        "blocks": [
                            {
                                "id": "show",
                                "type": "showCharacter",
                                "characterId": "hero",
                                "expressionId": "blink",
                                "atMs": 0,
                            }
                        ],
                    }
                ],
            }
        ],
    }
    result = compile_galgame_render_plan(
        document,
        {
            "scope": "clip",
            "clipRange": {"fragmentId": "main", "startMs": 750, "endMs": 1400},
            "resolvedFragmentIds": ["main"],
        },
        fragment_durations_ms=[650],
        total_ms=650,
        asset_paths={
            "file-one": Path("/tmp/one.png"),
            "file-two": Path("/tmp/two.png"),
            "file-three": Path("/tmp/three.png"),
        },
    )
    actor = next(track for track in result.plan.document.tracks if track.name == "角色 · 主角")
    assert [clip.asset_id for clip in actor.clips] == ["file-two", "file-three"]
    assert actor.clips[0].duration_us == 250_000
    assert actor.clips[1].duration_us == 400_000


def test_composed_stage_camera_and_sprite_motion_changes_rendered_pixels(tmp_path: Path) -> None:
    portrait = tmp_path / "portrait.png"
    Image.new("RGBA", (100, 200), (255, 20, 20, 255)).save(portrait)
    document = {
        "assets": [{"id": "face", "fileId": "file-face"}],
        "settings": {
            "characterStage": {
                "anchor": "bottomCenter",
                "defaultHeightPercent": 20,
                "positionPresets": [{"id": "center", "x": 50, "y": 90}],
            }
        },
        "scenes": [],
        "cgs": [],
        "characters": [
            {
                "id": "hero",
                "name": "主角",
                "defaultExpressionId": "normal",
                "expressions": [{"id": "normal", "assetId": "face"}],
                "displayNames": [],
            }
        ],
        "presentation": {"dialogueBox": {}},
        "chapters": [
            {
                "id": "chapter",
                "fragments": [
                    {
                        "id": "main",
                        "timeline": {"durationMs": 600},
                        "blocks": [
                            {
                                "id": "show",
                                "type": "showCharacter",
                                "characterId": "hero",
                                "positionId": "center",
                                "transition": {"fade": False, "durationMs": 0},
                                "atMs": 0,
                            },
                            {
                                "id": "camera",
                                "type": "camera",
                                "target": "characters",
                                "x": 2,
                                "y": -1,
                                "scale": 1.1,
                                "rotation": 0,
                                "durationMs": 500,
                                "easing": "linear",
                                "atMs": 0,
                            },
                            {
                                "id": "stage",
                                "type": "stageAnimation",
                                "animation": "fade",
                                "durationMs": 500,
                                "atMs": 0,
                            },
                            {
                                "id": "startle",
                                "type": "animateSprite",
                                "characterId": "hero",
                                "animation": "startle",
                                "durationMs": 520,
                                "intensity": 1,
                                "easing": "easeInOut",
                                "atMs": 0,
                            },
                        ],
                    }
                ],
            }
        ],
    }
    result = compile_galgame_render_plan(
        document,
        {"resolvedFragmentIds": ["main"], "preset": "1080p30"},
        fragment_durations_ms=[600],
        total_ms=600,
        asset_paths={"file-face": portrait},
    )
    actor = next(track for track in result.plan.document.tracks if track.name == "角色 · 主角")
    first = actor.clips[0]
    keys = [(key.property, key.time_us) for key in first.keyframes]
    assert len(keys) == len(set(keys))
    assert any(key.property == "y" and key.value != first.transform.y for key in first.keyframes)
    start = Image.open(io.BytesIO(render_plan_frame(result.plan, time_us=1_000)))
    peak = Image.open(io.BytesIO(render_plan_frame(result.plan, time_us=130_000)))
    assert start.tobytes() != peak.tobytes()
    assert any(key.property == "opacity" and key.value == 0.35 for key in first.keyframes)
