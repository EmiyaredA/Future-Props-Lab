"""Internal visual effects preserve composite playback and editable phase windows."""

import io
import subprocess
import threading
from copy import deepcopy
from uuid import uuid4

import httpx
import pytest
from PIL import Image, ImageDraw
from pydantic import ValidationError

from app.capabilities.media_rendering.contracts import RenderCaptureFrame
from app.capabilities.media_rendering.evaluator import FrameSource, TimelineFrameRenderer
from app.capabilities.media_rendering.render_engine import RENDER_PRESETS, render_document
from app.capabilities.media_rendering.timed_effects import effect_progress
from app.capabilities.media_rendering.timeline_document import parse_timeline_document
from app.main import app
from studio.apps.video_editor.clip_merging.document import (
    render_snapshot,
    replace_selection,
    selection,
)
from studio.apps.video_editor.schemas import VideoEditorTimelineBatchIn
from studio.apps.video_editor.timeline import apply_operations


def document(kind="flash"):
    return {
        "tracks": [
            {
                "id": "v",
                "name": "V",
                "kind": "visual",
                "order": 0,
                "clips": [
                    {
                        "id": "composite",
                        "trackId": "v",
                        "kind": "image",
                        "name": "full composite",
                        "assetId": "pattern",
                        "timelineStartUs": 0,
                        "durationUs": 4_000_000,
                        "timedEffects": [
                            {
                                "id": "pulse",
                                "kind": kind,
                                "startUs": 1_000_000,
                                "durationUs": 2_000_000,
                            }
                        ],
                    }
                ],
            }
        ]
    }


def apply(raw, *operations):
    result = apply_operations(
        raw,
        VideoEditorTimelineBatchIn(
            expectedRevision=0, requestId="timed-effect-test", operations=list(operations)
        ),
    )
    parse_timeline_document(result)
    return result


def clip(raw, index=0):
    return raw["tracks"][0]["clips"][index]


def pattern():
    image = Image.new("RGBA", (160, 90), "#273955")
    ImageDraw.Draw(image).rectangle((35, 20, 50, 65), fill="white")
    return image


@pytest.mark.parametrize("kind", ["flash", "whip-pan", "light-leak", "spin-blur", "zoom", "blur"])
def test_internal_pulse_is_visible_only_inside_window_without_replaying_source(kind):
    raw = document(kind)
    parsed = parse_timeline_document(raw)
    parsed.settings = parsed.settings.model_copy(update={"width": 160, "height": 90})
    parsed.tracks[0].clips[0].transform.x = 80
    parsed.tracks[0].clips[0].transform.y = 45
    baseline = parsed.model_copy(deep=True)
    baseline.tracks[0].clips[0].timed_effects = []
    source = FrameSource(lambda *_: pattern(), lambda _: None)
    renderer, plain = TimelineFrameRenderer(parsed, source), TimelineFrameRenderer(baseline, source)
    for at in [0, 999_999, 1_000_000, 3_000_000, 3_999_999]:
        assert renderer.render(at).tobytes() == plain.render(at).tobytes()
    assert renderer.render(2_000_000).tobytes() != plain.render(2_000_000).tobytes()
    assert len(parsed.tracks[0].clips) == 1
    assert parsed.tracks[0].clips[0].duration_us == 4_000_000


@pytest.mark.parametrize(
    "change",
    [
        {"startUs": -1},
        {"durationUs": 0},
        {"startUs": 3_000_000},
        {"kind": "crossfade"},
        {"progressStart": 0.8, "progressEnd": 0.2},
    ],
)
def test_effect_validation_rejects_invalid_ranges_and_dual_clip_kinds(change):
    raw = document()
    clip(raw)["timedEffects"][0].update(change)
    with pytest.raises(ValidationError):
        parse_timeline_document(raw)


def test_duplicate_ids_and_audio_rejected_but_old_document_defaults_empty():
    raw = document()
    clip(raw)["timedEffects"] *= 2
    with pytest.raises(ValidationError):
        parse_timeline_document(raw)
    clip(raw)["timedEffects"] = clip(raw)["timedEffects"][:1]
    clip(raw)["kind"] = "audio"
    with pytest.raises(ValidationError):
        parse_timeline_document(raw)
    del clip(raw)["timedEffects"]
    assert parse_timeline_document(raw).tracks[0].clips[0].timed_effects == []


def test_cut_can_end_light_leak_at_bright_phase_without_changing_source_clock():
    raw = document("light-leak")
    clip(raw).update(kind="video", sourceInUs=5_000_000, playbackRate=2)
    clip(raw)["timedEffects"][0]["progressEnd"] = 0.5
    parsed = parse_timeline_document(raw)
    parsed.settings = parsed.settings.model_copy(update={"width": 160, "height": 90})
    parsed.tracks[0].clips[0].transform.x = 80
    parsed.tracks[0].clips[0].transform.y = 45
    sampled = []

    def source(current, local_us):
        sampled.append((current.source_in_us, current.playback_rate, local_us))
        return pattern()

    renderer = TimelineFrameRenderer(parsed, FrameSource(source, lambda _: None))
    bright = renderer.render(2_999_999).getpixel((80, 45))
    clean = renderer.render(3_000_000).getpixel((80, 45))
    assert bright[0] > clean[0] + 180
    assert sampled == [(5_000_000, 2, 2_999_999), (5_000_000, 2, 3_000_000)]


def test_trim_split_and_speed_preserve_effect_phase_and_source_time():
    raw = document("light-leak")
    original = parse_timeline_document(raw).tracks[0].clips[0].timed_effects[0]
    trimmed = apply(
        raw,
        {
            "type": "trimClip",
            "clipId": "composite",
            "timelineStartUs": 1_500_000,
            "sourceInUs": 1_500_000,
            "durationUs": 1_000_000,
        },
    )
    current = parse_timeline_document(trimmed).tracks[0].clips[0].timed_effects[0]
    assert current.start_us == 0 and current.duration_us == 1_000_000
    assert current.progress_start == 0.25 and current.progress_end == 0.75
    assert effect_progress(current, 250_000) == effect_progress(original, 1_750_000)
    split = apply(
        raw, {"type": "splitClip", "clipId": "composite", "atUs": 2_000_000, "newClipId": "right"}
    )
    left, right = [item.timed_effects[0] for item in parse_timeline_document(split).tracks[0].clips]
    assert left.progress_end == right.progress_start == 0.5
    assert effect_progress(right, 500_000) == effect_progress(original, 2_500_000)
    assert clip(split, 1)["sourceInUs"] == 2_000_000
    video = deepcopy(raw)
    clip(video)["kind"] = "video"
    sped = apply(video, {"type": "setClipSpeed", "clipId": "composite", "playbackRate": 2})
    pulse = clip(sped)["timedEffects"][0]
    assert (pulse["startUs"], pulse["durationUs"], clip(sped)["durationUs"]) == (
        500_000,
        1_000_000,
        2_000_000,
    )
    assert len(sped["tracks"][0]["clips"]) == 1


@pytest.mark.parametrize("fps", [30, 60])
def test_one_frame_flash_is_visible_and_has_no_residue(fps):
    raw = document()
    pulse = clip(raw)["timedEffects"][0]
    pulse.update(startUs=1_000_000, durationUs=round(1_000_000 / fps))
    parsed = parse_timeline_document(raw)
    parsed.settings = parsed.settings.model_copy(update={"width": 160, "height": 90, "fps": fps})
    parsed.tracks[0].clips[0].transform.x = 80
    parsed.tracks[0].clips[0].transform.y = 45
    renderer = TimelineFrameRenderer(parsed, FrameSource(lambda *_: pattern(), lambda _: None))
    before = renderer.render(1_000_000 - 1).getpixel((80, 45))
    flash = renderer.render(1_000_000).getpixel((80, 45))
    after = renderer.render(1_000_000 + pulse["durationUs"]).getpixel((80, 45))
    assert flash[0] > before[0] + 150
    assert before == after


async def test_public_api_save_cas_undo_redo_and_reload():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "Internal pulses"})
        ).json()
        root = f"/v1/video-editor/projects/{project['id']}"
        png = io.BytesIO()
        pattern().save(png, format="PNG")
        asset = (
            await client.post(
                f"{root}/assets", files={"upload": ("pattern.png", png.getvalue(), "image/png")}
            )
        ).json()
        state = (await client.get(f"{root}/timeline")).json()
        new_clip = clip(document())
        new_clip["trackId"] = state["document"]["tracks"][0]["id"]
        new_clip["assetId"] = asset["id"]
        new_clip.pop("timedEffects")

        async def submit(operations, revision=None):
            nonlocal state
            response = await client.post(
                f"{root}/timeline/operations",
                json={
                    "expectedRevision": state["revision"] if revision is None else revision,
                    "requestId": str(uuid4()),
                    "operations": operations,
                },
            )
            if response.status_code == 200:
                state = response.json()
            return response

        assert (await submit([{"type": "addClip", "clip": new_clip}])).status_code == 200
        base_revision = state["revision"]
        effects = clip(document())["timedEffects"]
        edit = {"type": "updateClip", "clipId": "composite", "patch": {"timedEffects": effects}}
        assert (await submit([edit])).status_code == 200
        saved = clip(state["document"])["timedEffects"]
        assert saved[0]["kind"] == "flash"
        assert (await submit([edit], base_revision)).status_code == 409
        invalid = deepcopy(effects)
        invalid[0]["startUs"] = 4_000_000
        assert (await submit([{**edit, "patch": {"timedEffects": invalid}}])).status_code == 422
        assert (await submit([{**edit, "patch": {"timedEffects": []}}])).status_code == 200
        assert clip(state["document"])["timedEffects"] == []
        assert (await submit([edit])).status_code == 200
        assert clip(state["document"])["timedEffects"] == saved
        reloaded = (await client.get(f"{root}/timeline")).json()
        assert clip(reloaded["document"])["timedEffects"] == saved


def test_merge_bakes_effects_once_and_undo_restores_editable_pulses():
    raw = document()
    clip(raw)["kind"] = "video"
    second = deepcopy(clip(raw))
    second.update(id="second", timelineStartUs=4_000_000)
    raw["tracks"][0]["clips"].append(second)
    source = selection(raw, ["composite", "second"])
    snapshot = render_snapshot(raw, source)
    assert all(item["timedEffects"] for item in snapshot["tracks"][0]["clips"])
    context = {"source": source, "assetId": "baked", "name": "baked composite"}
    baked = replace_selection(raw, context, "merged", undo=False)
    assert clip(baked)["timedEffects"] == []
    restored = replace_selection(baked, context, "merged", undo=True)
    assert [item["timedEffects"] for item in restored["tracks"][0]["clips"]] == [
        item["timedEffects"] for item in source["clips"]
    ]


def test_encoded_export_keeps_single_frame_flash(tmp_path, monkeypatch):
    source = tmp_path / "pattern.png"
    pattern().save(source)
    raw = document()
    pulse = clip(raw)["timedEffects"][0]
    pulse.update(startUs=100_000, durationUs=33_333)
    clip(raw)["durationUs"] = 300_000
    parsed = parse_timeline_document(raw)
    parsed.settings = parsed.settings.model_copy(update={"width": 160, "height": 90})
    parsed.tracks[0].clips[0].transform.x = 80
    parsed.tracks[0].clips[0].transform.y = 45
    monkeypatch.setitem(RENDER_PRESETS, "tiny", (160, 90, 30))
    output = tmp_path / "flash.mp4"
    render_document(
        parsed,
        {"pattern": source},
        output,
        preset="tiny",
        start_us=0,
        end_us=300_000,
        cancel=threading.Event(),
        progress=lambda _: None,
        capture_frame=RenderCaptureFrame(width=160, height=90),
    )
    decoded = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(output),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ],
        capture_output=True,
        check=True,
        timeout=30,
    ).stdout
    frame_bytes = 160 * 90 * 3
    assert len(decoded) == frame_bytes * 9
    red = [decoded[index * frame_bytes + (45 * 160 + 80) * 3] for index in range(9)]
    assert red[3] > red[2] + 150
    assert abs(red[2] - red[4]) < 5
