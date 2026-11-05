import asyncio
import io
import threading
import wave
from copy import deepcopy
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select

from app.main import app
from app.runtime.db import SessionLocal
from studio.apps.video_editor.errors import VideoEditorValidationError
from studio.apps.video_editor.runner import VideoEditorRunner
from studio.apps.video_editor.schemas import VideoEditorClip, VideoEditorTimelineBatchIn
from studio.apps.video_editor.storage.models import VideoEditorTask
from studio.apps.video_editor.timeline import apply_operations


def clip(clip_id, track="v", start=0, duration=4_000_003, group=None):
    return VideoEditorClip.model_validate(
        {
            "id": clip_id,
            "name": clip_id,
            "trackId": track,
            "kind": "audio" if track == "a" else "video",
            "assetId": "asset",
            "timelineStartUs": start,
            "durationUs": duration,
            "playbackRate": 1,
            "linkGroupId": group,
        }
    ).model_dump(mode="json", by_alias=True, exclude_none=True)


def document(count=2):
    picture = clip("selected", group="selected-av")
    picture["keyframes"] = [
        {
            "id": "key",
            "timeUs": 2_000_001,
            "property": "opacity",
            "interpolation": "linear",
            "value": 0.5,
        }
    ]
    picture["transitionOut"] = {
        "kind": "crossfade",
        "durationUs": 1_000_001,
        "direction": "left",
        "easing": "linear",
    }
    video = [picture]
    audio = [clip("selected-audio", "a", group="selected-av")]
    for index in range(count):
        start = 4_000_003 + index * 2_500_000
        video.append(clip(f"next-{index}", start=start, duration=2_000_000, group=f"av-{index}"))
        audio.append(
            clip(f"sound-{index}", "a", start=start, duration=2_000_000, group=f"av-{index}")
        )
    audio.append(clip("music", "a", start=8_000_000))
    return {
        "tracks": [
            {"id": "v", "kind": "visual", "clips": video},
            {"id": "a", "kind": "audio", "clips": audio},
        ]
    }


def apply(doc, *operations):
    return apply_operations(
        doc,
        VideoEditorTimelineBatchIn(
            expectedRevision=0,
            requestId="ripple-test",
            operations=list(operations),
        ),
    )


def speed(rate, ripple=True):
    return {"type": "setClipSpeed", "clipId": "selected", "playbackRate": rate, "ripple": ripple}


def clips(doc):
    return {item["id"]: item for track in doc["tracks"] for item in track["clips"]}


@pytest.mark.parametrize("rate", [0.25, 0.5, 1.25, 2, 4])
@pytest.mark.parametrize("count", [0, 2, 250])
def test_ripple_preserves_seams_gaps_links_and_exact_undo(rate, count):
    original = document(count)
    before = deepcopy(original)
    result = apply(original, speed(rate))
    items = clips(result)
    delta = items["selected"]["durationUs"] - 4_000_003
    assert items["selected"]["timelineStartUs"] == 0
    assert items["selected-audio"]["durationUs"] == items["selected"]["durationUs"]
    for index in range(count):
        expected = 4_000_003 + index * 2_500_000 + delta
        assert items[f"next-{index}"]["timelineStartUs"] == expected
        assert items[f"sound-{index}"]["timelineStartUs"] == expected
    assert items["music"] == clips(original)["music"]
    restored = apply(result, {"type": "restoreClipStates", "clips": list(clips(original).values())})
    assert restored == original == before
    assert apply(restored, speed(rate)) == result
    second = apply(result, speed(1.7))
    assert apply(second, {"type": "restoreClipStates", "clips": list(items.values())}) == result


def test_legacy_and_disabled_ripple_keep_following_positions():
    for operation in [
        speed(2, False),
        {"type": "setClipSpeed", "clipId": "selected", "playbackRate": 2},
    ]:
        result = clips(apply(document(), operation))
        assert result["next-0"]["timelineStartUs"] == 4_000_003
        assert result["sound-0"]["timelineStartUs"] == 4_000_003


def test_ripple_rejects_locked_following_link_and_negative_time_atomically():
    original = document()
    # Separate the current linked audio from the locked followers.
    original["tracks"][1]["clips"] = original["tracks"][1]["clips"][1:]
    original["tracks"][1]["locked"] = True
    before = deepcopy(original)
    with pytest.raises(VideoEditorValidationError, match="锁定"):
        apply(original, speed(2))
    assert original == before
    original["tracks"][1]["locked"] = False
    original["tracks"][1]["clips"][0]["timelineStartUs"] = 0
    with pytest.raises(VideoEditorValidationError, match="起点之前"):
        apply(original, speed(2))


@pytest.mark.parametrize("change", ["missing", "track", "locked", "duplicate"])
def test_restore_rejects_invalid_targets(change):
    original = document()
    restored = deepcopy(original["tracks"][0]["clips"][0])
    if change == "missing":
        restored["id"] = "other-project-clip"
    if change == "track":
        restored["trackId"] = "a"
    if change == "locked":
        original["tracks"][0]["locked"] = True
    before = deepcopy(original)
    with pytest.raises((VideoEditorValidationError, ValueError)):
        apply(
            original,
            {
                "type": "restoreClipStates",
                "clips": [restored] * (2 if change == "duplicate" else 1),
            },
        )
    assert original == before


@pytest.mark.asyncio
async def test_ripple_api_conflicts_collisions_and_restore_validation():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "跟随契约"})
        ).json()
        base = f"/v1/video-editor/projects/{project['id']}/timeline"
        state = (await client.get(base)).json()

        async def submit(operations, revision=None):
            return await client.post(
                f"{base}/operations",
                json={
                    "expectedRevision": state["revision"] if revision is None else revision,
                    "requestId": str(uuid4()),
                    "operations": operations,
                },
            )

        # A deterministic WAV uploaded through the application API.
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as output:
            output.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
            output.writeframes(b"\0\0" * 8000 * 10)
        uploaded = await client.post(
            f"/v1/video-editor/projects/{project['id']}/assets",
            files={"upload": ("tone.wav", buffer.getvalue(), "audio/wav")},
        )
        assert uploaded.status_code == 200, uploaded.text
        asset_id = uploaded.json()["id"]
        a = clip("selected", "a", duration=4_000_000)
        a.update(trackId="audio-1", assetId=asset_id)
        b = {**a, "id": "next", "timelineStartUs": 4_000_000, "durationUs": 1_000_000}
        response = await submit([{"type": "addClip", "clip": a}, {"type": "addClip", "clip": b}])
        assert response.status_code == 200, response.text
        state = response.json()
        before = deepcopy(state)
        saved = await submit([speed(2)])
        assert saved.status_code == 200, saved.text
        state = saved.json()
        assert clips(state["document"])["next"]["timelineStartUs"] == 2_000_000
        stale = await submit([speed(4)], before["revision"])
        assert stale.status_code == 409
        assert (await client.get(base)).json() == state
        restored = await submit(
            [{"type": "restoreClipStates", "clips": list(clips(before["document"]).values())}]
        )
        assert restored.status_code == 200, restored.text
        state = restored.json()
        assert state["document"] == before["document"]
        invalid = {**clips(state["document"])["next"], "assetId": "foreign-asset"}
        failed = await submit([{"type": "restoreClipStates", "clips": [invalid]}])
        assert failed.status_code == 422
        assert (await client.get(base)).json() == state
        # Restore still runs the ordinary visual overlap validator.
        black = {
            "id": "black",
            "trackId": "visual-1",
            "kind": "color",
            "name": "black",
            "color": "#000000",
            "timelineStartUs": 0,
            "durationUs": 1_000_000,
        }
        response = await submit(
            [
                {"type": "addClip", "clip": black},
                {
                    "type": "addClip",
                    "clip": {**black, "id": "black2", "timelineStartUs": 1_000_000},
                },
            ]
        )
        state = response.json()
        invalid = {**clips(state["document"])["black2"], "timelineStartUs": 500_000}
        failed = await submit([{"type": "restoreClipStates", "clips": [invalid]}])
        assert failed.status_code == 422
        assert (await client.get(base)).json() == state


@pytest.mark.asyncio
async def test_media_duration_is_published_before_preview_encoding(monkeypatch):
    from studio.apps.video_editor import runner as runner_module

    started, release = threading.Event(), threading.Event()
    prepare = runner_module.prepare_media

    def paused_prepare(source, asset_id, media_kind, derived, probe=None):
        assert probe["durationUs"] == 1_000_000
        started.set()
        assert release.wait(10), "test did not release preview encoding"
        return prepare(source, asset_id, media_kind, derived, probe)

    monkeypatch.setattr(runner_module, "prepare_media", paused_prepare)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
        output.writeframes(b"\0\0" * 8000)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "预览准备"})
        ).json()
        base = f"/v1/video-editor/projects/{project['id']}"
        asset = (
            await client.post(
                f"{base}/assets", files={"upload": ("short.wav", buffer.getvalue(), "audio/wav")}
            )
        ).json()
        # Read the task identity in the isolated test database; all test data
        # and timeline edits are created through the formal API.
        async with SessionLocal() as session:
            task_id = await session.scalar(
                select(VideoEditorTask.id).where(VideoEditorTask.project_id == project["id"])
            )
        running = asyncio.create_task(VideoEditorRunner()._process(task_id))
        try:
            assert await asyncio.to_thread(started.wait, 5)
            current = (await client.get(f"{base}/assets")).json()["items"][0]
            assert current["processingStatus"] == "processing"
            assert current["probe"]["durationUs"] == 1_000_000
            assert current["proxyUrl"] is None
            item = clip("early", "a", duration=1_000_000)
            item.update(trackId="audio-1", assetId=asset["id"])
            response = await client.post(
                f"{base}/timeline/operations",
                json={
                    "expectedRevision": 0,
                    "requestId": str(uuid4()),
                    "operations": [{"type": "addClip", "clip": item}],
                },
            )
            assert response.status_code == 200, response.text
            invalid = {**item, "id": "too-long", "durationUs": 2_000_000}
            response = await client.post(
                f"{base}/timeline/operations",
                json={
                    "expectedRevision": 1,
                    "requestId": str(uuid4()),
                    "operations": [{"type": "addClip", "clip": invalid}],
                },
            )
            assert response.status_code == 422
        finally:
            release.set()
            await running
        current = (await client.get(f"{base}/assets")).json()["items"][0]
        assert current["processingStatus"] == "ready"
        assert current["proxyUrl"]
