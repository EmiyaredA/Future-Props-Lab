from __future__ import annotations

import io
import subprocess
import threading
import wave
from copy import deepcopy
from pathlib import Path

import httpx
import numpy as np
import pytest
from sqlalchemy import select

from app.capabilities.media_rendering.audio_transitions import seam_gain, sweep_frequency
from app.capabilities.media_rendering.render_engine import _mux_audio
from app.capabilities.media_rendering.timeline_document import parse_timeline_document
from studio.apps.video_editor.errors import VideoEditorValidationError
from studio.apps.video_editor.schemas import VideoEditorTimelineBatchIn
from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata
from studio.apps.video_editor.timeline import apply_operations
from website_test_support import SessionLocal, app


def document() -> dict:
    return {
        "settings": {"width": 1920, "height": 1080, "fps": 30},
        "tracks": [
            {
                "id": "music",
                "kind": "audio",
                "order": 0,
                "clips": [
                    {
                        "id": "a",
                        "trackId": "music",
                        "kind": "audio",
                        "name": "A",
                        "assetId": "a",
                        "timelineStartUs": 0,
                        "durationUs": 5_000_000,
                    },
                    {
                        "id": "b",
                        "trackId": "music",
                        "kind": "audio",
                        "name": "B",
                        "assetId": "b",
                        "timelineStartUs": 5_000_000,
                        "durationUs": 5_000_000,
                    },
                    {
                        "id": "c",
                        "trackId": "music",
                        "kind": "audio",
                        "name": "C",
                        "assetId": "c",
                        "timelineStartUs": 10_000_000,
                        "durationUs": 2_000_000,
                        "linkGroupId": "later",
                    },
                ],
            },
            {
                "id": "visual",
                "kind": "visual",
                "order": 1,
                "clips": [
                    {
                        "id": "picture",
                        "trackId": "visual",
                        "kind": "image",
                        "name": "Picture",
                        "assetId": "image",
                        "timelineStartUs": 10_000_000,
                        "durationUs": 2_000_000,
                        "linkGroupId": "later",
                    }
                ],
            },
        ],
        "transitions": [],
    }


def apply(doc: dict, **patch: object) -> dict:
    operation = {
        "type": "setAudioTransition",
        "fromClipId": "a",
        "toClipId": "b",
        "transitionId": "join",
        "kind": "audio-equal-power",
        "durationUs": 500_000,
        **patch,
    }
    return apply_operations(
        doc,
        VideoEditorTimelineBatchIn(
            expectedRevision=0, requestId="audio-transition-test", operations=[operation]
        ),
    )


def test_audio_transition_creates_overlap_and_moves_following_link_group() -> None:
    original = document()
    result = apply(original)
    audio = result["tracks"][0]["clips"]
    assert audio[1]["timelineStartUs"] == 4_500_000
    assert audio[2]["timelineStartUs"] == 9_500_000
    assert result["tracks"][1]["clips"][0]["timelineStartUs"] == 9_500_000
    assert result["transitions"][0]["durationUs"] == 500_000
    assert original == document()
    resized = apply(result, durationUs=800_000, kind="audio-filter-sweep")
    assert resized["tracks"][0]["clips"][1]["timelineStartUs"] == 4_200_000
    assert resized["tracks"][0]["clips"][2]["timelineStartUs"] == 9_200_000
    assert resized["transitions"][0]["kind"] == "audio-filter-sweep"


def test_audio_transition_undo_and_redo_restore_exact_timeline() -> None:
    original = document()
    applied = apply(original)
    undone = apply_operations(
        applied,
        VideoEditorTimelineBatchIn(
            expectedRevision=1,
            requestId="audio-transition-undo",
            operations=[
                {"type": "removeTransition", "transitionId": "join"},
                {
                    "type": "restoreClipStates",
                    "clips": [
                        original["tracks"][0]["clips"][1],
                        original["tracks"][0]["clips"][2],
                        original["tracks"][1]["clips"][0],
                    ],
                },
            ],
        ),
    )
    assert undone["transitions"] == []
    assert [clip["timelineStartUs"] for clip in undone["tracks"][0]["clips"]] == [
        0,
        5_000_000,
        10_000_000,
    ]
    assert undone["tracks"][1]["clips"][0]["timelineStartUs"] == 10_000_000
    redone = apply(undone)
    assert redone["transitions"] == applied["transitions"]
    assert [clip["timelineStartUs"] for clip in redone["tracks"][0]["clips"]] == [
        0,
        4_500_000,
        9_500_000,
    ]


def test_audio_effect_change_does_not_move_later_locked_link_group() -> None:
    existing = apply(document())
    existing["tracks"][1]["locked"] = True
    changed = apply(existing, kind="audio-dip")
    assert changed["tracks"][1]["clips"] == existing["tracks"][1]["clips"]
    assert changed["transitions"][0]["kind"] == "audio-dip"


@pytest.mark.asyncio
async def test_audio_transition_api_revision_and_undo() -> None:
    samples = np.zeros(48_000 * 3, dtype=np.int16)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(48_000)
        wav.writeframes(samples.tobytes())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "音频转场"})
        ).json()
        base = f"/v1/video-editor/projects/{project['id']}"
        upload = await client.post(
            f"{base}/assets", files={"upload": ("tone.wav", output.getvalue(), "audio/wav")}
        )
        assert upload.status_code == 200
        asset_id = upload.json()["id"]
        async with SessionLocal() as session:
            metadata = (
                await session.execute(
                    select(VideoEditorAssetMetadata).where(
                        VideoEditorAssetMetadata.asset_id == asset_id
                    )
                )
            ).scalar_one()
            metadata.processing_status = "ready"
            metadata.probe = {"durationUs": 3_000_000}
            await session.commit()
        initial = (await client.get(f"{base}/timeline")).json()
        track = next(item for item in initial["document"]["tracks"] if item["kind"] == "audio")
        clips = [
            {
                "id": clip_id,
                "trackId": track["id"],
                "kind": "audio",
                "name": clip_id,
                "assetId": asset_id,
                "timelineStartUs": start,
                "durationUs": 1_000_000,
            }
            for clip_id, start in (("a", 0), ("b", 1_000_000))
        ]
        added = await client.post(
            f"{base}/timeline/operations",
            json={
                "expectedRevision": initial["revision"],
                "requestId": "add-audio-clips",
                "operations": [{"type": "addClip", "clip": clip} for clip in clips],
            },
        )
        assert added.status_code == 200
        revision = added.json()["revision"]
        edit = {
            "type": "setAudioTransition",
            "fromClipId": "a",
            "toClipId": "b",
            "transitionId": "join",
            "kind": "audio-equal-power",
            "durationUs": 500_000,
            "easing": "linear",
        }
        stale = await client.post(
            f"{base}/timeline/operations",
            json={
                "expectedRevision": initial["revision"],
                "requestId": "stale-transition",
                "operations": [edit],
            },
        )
        assert stale.status_code == 409
        applied = await client.post(
            f"{base}/timeline/operations",
            json={
                "expectedRevision": revision,
                "requestId": "apply-transition",
                "operations": [edit],
            },
        )
        assert applied.status_code == 200
        assert applied.json()["revision"] == revision + 1
        assert applied.json()["document"]["transitions"][0]["kind"] == "audio-equal-power"
        undone = await client.post(
            f"{base}/timeline/operations",
            json={
                "expectedRevision": revision + 1,
                "requestId": "undo-transition",
                "operations": [
                    {"type": "removeTransition", "transitionId": "join"},
                    {"type": "restoreClipStates", "clips": clips[1:]},
                ],
            },
        )
        assert undone.status_code == 200
        assert undone.json()["document"] == added.json()["document"]
        visual = next(item for item in initial["document"]["tracks"] if item["kind"] == "visual")
        later = [
            {
                "type": "addClip",
                "clip": {
                    "id": "c",
                    "trackId": track["id"],
                    "kind": "audio",
                    "name": "c",
                    "assetId": asset_id,
                    "timelineStartUs": 2_000_000,
                    "durationUs": 1_000_000,
                    "linkGroupId": "later",
                },
            },
            {
                "type": "addClip",
                "clip": {
                    "id": "visual-before",
                    "trackId": visual["id"],
                    "kind": "color",
                    "name": "before",
                    "color": "#000000",
                    "timelineStartUs": 1_250_000,
                    "durationUs": 750_000,
                },
            },
            {
                "type": "addClip",
                "clip": {
                    "id": "visual-linked",
                    "trackId": visual["id"],
                    "kind": "color",
                    "name": "linked",
                    "color": "#000000",
                    "timelineStartUs": 2_000_000,
                    "durationUs": 1_000_000,
                    "linkGroupId": "later",
                },
            },
        ]
        prepared = await client.post(
            f"{base}/timeline/operations",
            json={
                "expectedRevision": undone.json()["revision"],
                "requestId": "prepare-overlap",
                "operations": later,
            },
        )
        assert prepared.status_code == 200
        conflict = await client.post(
            f"{base}/timeline/operations",
            json={
                "expectedRevision": prepared.json()["revision"],
                "requestId": "reject-overlap",
                "operations": [{**edit, "transitionId": "join-again"}],
            },
        )
        assert conflict.status_code == 422
        assert (await client.get(f"{base}/timeline")).json() == prepared.json()


@pytest.mark.parametrize(
    "change,code",
    [
        (
            lambda doc: doc["tracks"][0]["clips"][1].update(timelineStartUs=5_100_000),
            "audio_seam_gap",
        ),
        (lambda doc: doc["tracks"][0]["clips"][0].update(linkGroupId="av"), "linked_audio_seam"),
        (lambda doc: doc["tracks"][0].update(locked=True), "track_locked"),
        (lambda doc: doc["tracks"][1].update(locked=True), "track_locked"),
        (
            lambda doc: doc["tracks"][1]["clips"][0].update(timelineStartUs=0),
            "invalid_clip_start",
        ),
    ],
)
def test_audio_transition_rejects_invalid_edit(change, code: str) -> None:
    original = document()
    candidate = deepcopy(original)
    change(candidate)
    before = deepcopy(candidate)
    with pytest.raises(VideoEditorValidationError) as exc:
        apply(candidate)
    assert exc.value.code == code
    assert candidate == before


@pytest.mark.parametrize(
    "kind,middle",
    [
        ("audio-crossfade", (0.5, 0.5)),
        ("audio-equal-power", (2**-0.5, 2**-0.5)),
        ("audio-dip", (0.0, 0.0)),
        ("audio-filter-sweep", (0.5, 0.5)),
    ],
)
def test_audio_transition_gain_endpoints_and_midpoint(
    kind: str, middle: tuple[float, float]
) -> None:
    for progress, expected in ((0, (1, 0)), (0.5, middle), (1, (0, 1))):
        assert seam_gain(kind, progress, incoming=False) == pytest.approx(expected[0])
        assert seam_gain(kind, progress, incoming=True) == pytest.approx(expected[1])
    assert sweep_frequency(0, incoming=False) > sweep_frequency(1, incoming=False)
    assert sweep_frequency(0, incoming=True) > sweep_frequency(1, incoming=True)


@pytest.mark.parametrize(
    "kind", ["audio-crossfade", "audio-equal-power", "audio-dip", "audio-filter-sweep"]
)
def test_audio_transition_exports_real_audio(kind: str, tmp_path: Path) -> None:
    sample_rate = 48_000
    samples = (
        0.3 * np.sin(2 * np.pi * 440 * np.arange(sample_rate * 2) / sample_rate) * 32767
    ).astype(np.int16)
    source = tmp_path / "tone.wav"
    with wave.open(str(source), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(samples.tobytes())
    picture = tmp_path / "picture.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=16x16:r=10:d=1.5",
            "-c:v",
            "mpeg4",
            "-y",
            str(picture),
        ],
        check=True,
    )
    timeline = document()
    timeline["tracks"] = timeline["tracks"][:1]
    timeline["tracks"][0]["name"] = "Music"
    timeline["tracks"][0]["clips"] = timeline["tracks"][0]["clips"][:2]
    timeline["tracks"][0]["clips"][0]["durationUs"] = 1_000_000
    timeline["tracks"][0]["clips"][1]["timelineStartUs"] = 500_000
    timeline["tracks"][0]["clips"][1]["durationUs"] = 1_000_000
    timeline["transitions"] = [
        {
            "id": "join",
            "kind": kind,
            "durationUs": 500_000,
            "placement": "between",
            "fromClipId": "a",
            "toClipId": "b",
            "direction": "left",
            "easing": "linear",
        }
    ]
    rendered = tmp_path / "rendered.mp4"
    _mux_audio(
        parse_timeline_document(timeline),
        {"a": source, "b": source},
        picture,
        rendered,
        start_us=0,
        end_us=1_500_000,
        cancel=threading.Event(),
    )
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(rendered),
            "-f",
            "f32le",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-",
        ],
        check=True,
        capture_output=True,
    )
    decoded = np.frombuffer(result.stdout, dtype=np.float32)
    assert len(decoded) >= sample_rate
    assert np.max(np.abs(decoded)) > 0.1
    if kind == "audio-dip":
        middle = decoded[int(0.74 * sample_rate) : int(0.76 * sample_rate)]
        before = decoded[int(0.24 * sample_rate) : int(0.26 * sample_rate)]
        assert np.sqrt(np.mean(middle**2)) < np.sqrt(np.mean(before**2)) * 0.3


def test_exported_sweep_opens_incoming_highpass(tmp_path: Path) -> None:
    sample_rate = 48_000
    tone = (
        0.3 * np.sin(2 * np.pi * 440 * np.arange(sample_rate * 2) / sample_rate) * 32767
    ).astype(np.int16)
    sources = []
    for name, samples in (("silent", np.zeros_like(tone)), ("tone", tone)):
        path = tmp_path / f"{name}.wav"
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(sample_rate)
            output.writeframes(samples.tobytes())
        sources.append(path)
    picture = tmp_path / "picture.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=16x16:r=10:d=1.5",
            "-c:v",
            "mpeg4",
            "-y",
            str(picture),
        ],
        check=True,
    )
    timeline = document()
    timeline["tracks"] = timeline["tracks"][:1]
    timeline["tracks"][0]["name"] = "Music"
    timeline["tracks"][0]["clips"] = timeline["tracks"][0]["clips"][:2]
    timeline["tracks"][0]["clips"][0]["durationUs"] = 1_000_000
    timeline["tracks"][0]["clips"][1]["timelineStartUs"] = 500_000
    timeline["tracks"][0]["clips"][1]["durationUs"] = 1_000_000
    timeline["transitions"] = [
        {
            "id": "join",
            "kind": "audio-filter-sweep",
            "durationUs": 500_000,
            "placement": "between",
            "fromClipId": "a",
            "toClipId": "b",
            "direction": "left",
            "easing": "linear",
        }
    ]
    rendered = tmp_path / "sweep.mp4"
    _mux_audio(
        parse_timeline_document(timeline),
        {"a": sources[0], "b": sources[1]},
        picture,
        rendered,
        start_us=0,
        end_us=1_500_000,
        cancel=threading.Event(),
    )
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(rendered),
            "-f",
            "f32le",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-",
        ],
        check=True,
        capture_output=True,
    )
    decoded = np.frombuffer(result.stdout, dtype=np.float32)

    def rms(at: float) -> float:
        window = decoded[int((at - 0.01) * sample_rate) : int((at + 0.01) * sample_rate)]
        return float(np.sqrt(np.mean(window**2)))

    early_normalized = rms(0.55) / 0.1
    late_normalized = rms(0.95) / 0.9
    assert late_normalized > early_normalized * 2
