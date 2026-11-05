from __future__ import annotations

import io
import wave

import httpx
import numpy as np
import pytest
from sqlalchemy import select

from studio.apps.media_rendering.local.audio_matching import SAMPLE_RATE, rank_audio_seams
from studio.apps.video_editor.audio_alignment.audio_matching import VideoEditorAudioMatching
from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.schemas import VideoEditorTimelineBatchIn
from studio.apps.video_editor.schemas.audio_seam import AudioSeamCandidatesIn
from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata
from studio.apps.video_editor.timeline import apply_operations
from website_test_support import SessionLocal, app


def _document() -> dict:
    return {
        "settings": {"width": 1920, "height": 1080, "fps": 30, "backgroundColor": "#000000"},
        "tracks": [
            {
                "id": "a1",
                "kind": "audio",
                "name": "music",
                "order": 0,
                "clips": [
                    {
                        "id": "a",
                        "trackId": "a1",
                        "kind": "audio",
                        "name": "A",
                        "assetId": "song",
                        "timelineStartUs": 0,
                        "durationUs": 5_000_000,
                        "sourceInUs": 0,
                    },
                    {
                        "id": "b",
                        "trackId": "a1",
                        "kind": "audio",
                        "name": "B",
                        "assetId": "song",
                        "timelineStartUs": 5_000_000,
                        "durationUs": 5_000_000,
                        "sourceInUs": 8_000_000,
                    },
                    {
                        "id": "c",
                        "trackId": "a1",
                        "kind": "audio",
                        "name": "C",
                        "assetId": "song",
                        "timelineStartUs": 10_000_000,
                        "durationUs": 2_000_000,
                        "sourceInUs": 13_000_000,
                    },
                ],
            }
        ],
        "transitions": [],
    }


def _apply(document: dict, *operations: dict) -> dict:
    return apply_operations(
        document,
        VideoEditorTimelineBatchIn(
            expectedRevision=0, requestId="audio-seam-test", operations=list(operations)
        ),
    )


def test_align_audio_seam_moves_following_clips_and_restores_atomically() -> None:
    original = _document()
    aligned = _apply(
        original,
        {
            "type": "alignAudioSeam",
            "fromClipId": "a",
            "toClipId": "b",
            "sourceInUs": 9_000_000,
            "fadeDurationUs": 200_000,
            "transitionId": "fade-1",
        },
    )
    a, b, c = aligned["tracks"][0]["clips"]
    assert a["durationUs"] == 5_000_000
    assert (b["sourceInUs"], b["timelineStartUs"], b["durationUs"]) == (
        9_000_000,
        4_800_000,
        5_000_000,
    )
    assert c["timelineStartUs"] == 9_800_000
    assert aligned["transitions"][0]["durationUs"] == 200_000
    restored = _apply(
        aligned,
        {"type": "removeTransition", "transitionId": "fade-1"},
        {"type": "restoreClipStates", "clips": original["tracks"][0]["clips"][1:]},
    )
    restored_clips = restored["tracks"][0]["clips"]
    assert [clip["timelineStartUs"] for clip in restored_clips] == [0, 5_000_000, 10_000_000]
    assert restored_clips[1]["sourceInUs"] == 8_000_000
    assert restored_clips[1]["durationUs"] == 5_000_000
    assert restored["transitions"] == []


@pytest.mark.parametrize(
    "change,code",
    [
        (
            lambda doc: doc["tracks"][0]["clips"][1].update(assetId="other"),
            "different_audio_assets",
        ),
        (lambda doc: doc["tracks"][0]["clips"][0].update(linkGroupId="av"), "linked_audio_seam"),
        (lambda doc: doc["tracks"][0].update(locked=True), "track_locked"),
    ],
)
def test_audio_seam_rejects_invalid_pairs(change, code: str) -> None:
    document = _document()
    change(document)
    with pytest.raises(VideoEditorValidationError) as exc:
        _apply(
            document,
            {
                "type": "alignAudioSeam",
                "fromClipId": "a",
                "toClipId": "b",
                "sourceInUs": 9_000_000,
                "fadeDurationUs": 200_000,
                "transitionId": "fade-1",
            },
        )
    assert exc.value.code == code


def test_audio_seam_rejects_locked_following_link_group() -> None:
    document = _document()
    document["tracks"][0]["clips"][2]["linkGroupId"] = "later-av"
    document["tracks"].append(
        {
            "id": "v1",
            "kind": "visual",
            "name": "picture",
            "order": 1,
            "locked": True,
            "clips": [
                {
                    "id": "picture",
                    "trackId": "v1",
                    "kind": "video",
                    "name": "picture",
                    "assetId": "video",
                    "timelineStartUs": 10_000_000,
                    "durationUs": 2_000_000,
                    "linkGroupId": "later-av",
                }
            ],
        }
    )
    with pytest.raises(VideoEditorValidationError) as exc:
        _apply(
            document,
            {
                "type": "alignAudioSeam",
                "fromClipId": "a",
                "toClipId": "b",
                "sourceInUs": 9_000_000,
                "fadeDurationUs": 200_000,
                "transitionId": "fade-1",
            },
        )
    assert exc.value.code == "track_locked"
    assert document["tracks"][0]["clips"][2]["timelineStartUs"] == 10_000_000


def test_repeated_music_phrase_produces_spaced_candidates() -> None:
    seconds = 15
    samples = np.zeros(seconds * SAMPLE_RATE, dtype=np.float32)
    t = np.arange(SAMPLE_RATE * 2, dtype=np.float32) / SAMPLE_RATE
    motif = 0.2 * np.sin(2 * np.pi * 440 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 2 * t))
    samples[3 * SAMPLE_RATE : 5 * SAMPLE_RATE] = motif
    samples[8 * SAMPLE_RATE : 10 * SAMPLE_RATE] = motif
    samples[11 * SAMPLE_RATE : 13 * SAMPLE_RATE] = motif
    start, candidates = rank_audio_seams(
        samples,
        reference_end_us=5_000_000,
        search_start_us=7_000_000,
        search_end_us=14_000_000,
        rate=1,
    )
    assert start == 3_000_000
    assert candidates
    assert abs(candidates[0].source_in_us - 8_000_000) < 350_000
    assert all(len(item.peaks) == 64 for item in candidates)
    assert all(
        abs(left.source_in_us - right.source_in_us) >= 1_000_000
        for left, right in zip(candidates, candidates[1:], strict=False)
    )


def test_silent_reference_has_no_reliable_candidate() -> None:
    samples = np.zeros(8 * SAMPLE_RATE, dtype=np.float32)
    samples[5 * SAMPLE_RATE : 7 * SAMPLE_RATE] = 0.3
    _start, candidates = rank_audio_seams(
        samples,
        reference_end_us=4_000_000,
        search_start_us=0,
        search_end_us=8_000_000,
        rate=1,
    )
    assert candidates == []


def test_unrelated_noise_does_not_produce_music_seam_candidates() -> None:
    samples = np.zeros(12 * SAMPLE_RATE, dtype=np.float32)
    t = np.arange(2 * SAMPLE_RATE) / SAMPLE_RATE
    samples[2 * SAMPLE_RATE : 4 * SAMPLE_RATE] = 0.2 * np.sin(2 * np.pi * 440 * t)
    samples[6 * SAMPLE_RATE : 11 * SAMPLE_RATE] = np.random.default_rng(2).normal(
        0, 0.2, 5 * SAMPLE_RATE
    )
    _start, candidates = rank_audio_seams(
        samples,
        reference_end_us=4_000_000,
        search_start_us=6_000_000,
        search_end_us=12_000_000,
        rate=1,
    )
    assert candidates == []


@pytest.mark.asyncio
async def test_audio_seam_api_requires_current_revision_and_ready_same_source() -> None:
    samples = np.zeros(14 * SAMPLE_RATE, dtype=np.int16)
    t = np.arange(2 * SAMPLE_RATE, dtype=np.float32) / SAMPLE_RATE
    motif = (12_000 * np.sin(2 * np.pi * 440 * t)).astype(np.int16)
    samples[3 * SAMPLE_RATE : 5 * SAMPLE_RATE] = motif
    samples[8 * SAMPLE_RATE : 10 * SAMPLE_RATE] = motif
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(samples.tobytes())
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "接缝分析"})
        ).json()
        project_id = project["id"]
        upload = await client.post(
            f"/v1/video-editor/projects/{project_id}/assets",
            files={"upload": ("song.wav", output.getvalue(), "audio/wav")},
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
            metadata.probe = {"durationUs": 14_000_000}
            await session.commit()
        document = (await client.get(f"/v1/video-editor/projects/{project_id}/timeline")).json()
        audio_track = next(
            item for item in document["document"]["tracks"] if item["kind"] == "audio"
        )
        clips = [
            {
                "id": clip_id,
                "trackId": audio_track["id"],
                "kind": "audio",
                "name": clip_id,
                "assetId": asset_id,
                "timelineStartUs": start,
                "sourceInUs": source_in,
                "durationUs": 5_000_000,
            }
            for clip_id, start, source_in in (("a", 0, 0), ("b", 5_000_000, 7_000_000))
        ]
        saved = await client.post(
            f"/v1/video-editor/projects/{project_id}/timeline/operations",
            json={
                "expectedRevision": document["revision"],
                "requestId": "audio-seam-add-clips",
                "operations": [{"type": "addClip", "clip": clip} for clip in clips],
            },
        )
        assert saved.status_code == 200
        url = f"/v1/video-editor/projects/{project_id}/audio-seams/candidates"
        stale = await client.post(
            url, json={"expectedRevision": 0, "fromClipId": "a", "toClipId": "b"}
        )
        assert stale.status_code == 409
        found = await client.post(
            url, json={"expectedRevision": 1, "fromClipId": "a", "toClipId": "b"}
        )
        assert found.status_code == 200
        assert found.json()["assetId"] == asset_id
        assert found.json()["candidates"]
        assert any(item["sourceInUs"] < 7_000_000 for item in found.json()["candidates"])
        original_timeline = (
            await client.get(f"/v1/video-editor/projects/{project_id}/timeline")
        ).json()
        assert original_timeline["revision"] == 1
        candidate = found.json()["candidates"][0]
        applied = await client.post(
            f"/v1/video-editor/projects/{project_id}/timeline/operations",
            json={
                "expectedRevision": 1,
                "requestId": "audio-seam-apply",
                "operations": [
                    {
                        "type": "alignAudioSeam",
                        "fromClipId": "a",
                        "toClipId": "b",
                        "sourceInUs": candidate["sourceInUs"],
                        "fadeDurationUs": candidate["suggestedFadeUs"],
                        "transitionId": "seam-transition",
                    }
                ],
            },
        )
        assert applied.status_code == 200
        applied_document = applied.json()["document"]
        assert applied_document["transitions"][0]["kind"] == "audio-crossfade"
        original_clips = next(
            item["clips"]
            for item in original_timeline["document"]["tracks"]
            if item["kind"] == "audio"
        )
        undone = await client.post(
            f"/v1/video-editor/projects/{project_id}/timeline/operations",
            json={
                "expectedRevision": 2,
                "requestId": "audio-seam-undo",
                "operations": [
                    {"type": "removeTransition", "transitionId": "seam-transition"},
                    {"type": "restoreClipStates", "clips": original_clips[1:]},
                ],
            },
        )
        assert undone.status_code == 200
        assert undone.json()["document"] == original_timeline["document"]
        async with SessionLocal() as session:
            metadata = await session.get(VideoEditorAssetMetadata, asset_id)
            assert metadata is not None
            metadata.processing_status = "processing"
            await session.commit()
        unavailable = await client.post(
            f"/v1/video-editor/projects/{project_id}/timeline/operations",
            json={
                "expectedRevision": 3,
                "requestId": "audio-seam-not-ready",
                "operations": [
                    {
                        "type": "alignAudioSeam",
                        "fromClipId": "a",
                        "toClipId": "b",
                        "sourceInUs": candidate["sourceInUs"],
                        "fadeDurationUs": candidate["suggestedFadeUs"],
                        "transitionId": "seam-transition",
                    }
                ],
            },
        )
        assert unavailable.status_code == 422
        assert unavailable.json()["code"] == "audio_not_ready"
        assert (await client.get(f"/v1/video-editor/projects/{project_id}/timeline")).json()[
            "revision"
        ] == 3
        async with SessionLocal() as session:
            with pytest.raises(VideoEditorNotFoundError):
                await VideoEditorAudioMatching(
                    session, "different-workspace", settings=app.state.settings
                ).candidates(
                    project_id,
                    AudioSeamCandidatesIn(expectedRevision=1, fromClipId="a", toClipId="b"),
                )
