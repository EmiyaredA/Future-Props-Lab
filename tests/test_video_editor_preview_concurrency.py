from __future__ import annotations

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.media_rendering.local.evaluator import FRAME_COMPOSITOR_VERSION
from studio.apps.media_rendering.local.inputs import RenderPlan
from studio.apps.media_rendering.local.text_layer import TEXT_RENDER_VERSION
from studio.apps.media_rendering.local.video_sampling import VIDEO_SAMPLING_VERSION
from studio.apps.video_editor import frames
from studio.apps.video_editor.schemas import VideoEditorTimelineDocument
from studio.config.settings import get_settings
from website_test_support import app, engine


@pytest.mark.asyncio
@pytest.mark.parametrize("preview_kind", ["frame", "text"])
async def test_split_saves_while_preview_is_still_rendering(monkeypatch, preview_kind):
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()

    def slow_render(*_args, **_kwargs):
        started.set()
        try:
            if not release.wait(5):
                raise TimeoutError("preview blocked the editing request")
            return b"preview"
        finally:
            finished.set()

    monkeypatch.setattr(
        frames, "render_plan_frame" if preview_kind == "frame" else "text_layer_png", slow_render
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "并发分割"})
        ).json()
        base = f"/v1/video-editor/projects/{project['id']}"
        added = await client.post(
            f"{base}/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": "add-text",
                "operations": [
                    {
                        "type": "addClip",
                        "clip": {
                            "id": "text",
                            "trackId": "visual-1",
                            "kind": "text",
                            "name": "字幕",
                            "text": "字幕",
                            "timelineStartUs": 0,
                            "durationUs": 2_000_000,
                        },
                    }
                ],
            },
        )
        assert added.status_code == 200, added.text
        url = (
            f"{base}/preview/frame?revision=1&timeUs=1000000"
            if preview_kind == "frame"
            else f"{base}/text-clips/text/layer?revision=1"
        )
        preview = asyncio.create_task(client.get(url))
        try:
            assert await asyncio.to_thread(started.wait, 2)
            assert not finished.is_set()
            assert engine.pool.checkedout() == 0
            split = await asyncio.wait_for(
                client.post(
                    f"{base}/timeline/operations",
                    json={
                        "expectedRevision": 1,
                        "requestId": "split-during-preview",
                        "operations": [
                            {
                                "type": "splitClip",
                                "clipId": "text",
                                "atUs": 1_000_000,
                                "newClipId": "right",
                            }
                        ],
                    },
                ),
                timeout=2,
            )
            assert split.status_code == 200, split.text
            assert split.json()["revision"] == 2
            assert len(split.json()["document"]["tracks"][0]["clips"]) == 2
            assert not finished.is_set()
            assert not preview.done()
        finally:
            release.set()
            # Retrieve errors too, so a failing regression does not leak a task.
            result = await asyncio.gather(preview, return_exceptions=True)
        assert isinstance(result[0], httpx.Response)
        assert result[0].status_code == 200
        assert result[0].headers["content-type"] == "image/png"


def test_parallel_exact_frames_publish_separate_atomic_cache_files(monkeypatch, tmp_path):
    render_barrier = threading.Barrier(2)
    publish_barrier = threading.Barrier(2)
    temporary_paths = []
    original_replace = frames.os.replace

    def render(*_args, **_kwargs):
        render_barrier.wait(timeout=2)
        return b"same-frame"

    def replace(source, destination):
        temporary_paths.append(source)
        publish_barrier.wait(timeout=2)
        original_replace(source, destination)

    monkeypatch.setattr(frames, "render_plan_frame", render)
    monkeypatch.setattr(frames.os, "replace", replace)
    cache = tmp_path / "frame.png"
    plan = RenderPlan(VideoEditorTimelineDocument.model_validate({"tracks": []}), {})

    def request():
        return frames._render_frame(cache, plan, time_us=0, width=960, without_chroma_clip_id=None)

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: request(), range(2)))
    assert responses == [b"same-frame", b"same-frame"]
    assert len(set(temporary_paths)) == 2
    assert cache.read_bytes() == b"same-frame"
    assert not list(tmp_path.glob("*.tmp"))
    # Cache hits return the bytes without invoking the barrier-backed renderer.
    assert request() == b"same-frame"


def test_frame_finishing_after_project_deletion_does_not_recreate_cache(monkeypatch, tmp_path):
    derived = tmp_path / "derived"
    derived.mkdir()

    def render(*_args, **_kwargs):
        derived.rmdir()
        return b"finished-frame"

    monkeypatch.setattr(frames, "render_plan_frame", render)
    plan = RenderPlan(VideoEditorTimelineDocument.model_validate({"tracks": []}), {})
    assert (
        frames._render_frame(
            derived / "frame.png", plan, time_us=0, width=960, without_chroma_clip_id=None
        )
        == b"finished-frame"
    )
    assert not derived.exists()


@pytest.mark.asyncio
async def test_exact_frame_ignores_cache_from_previous_sampling_rule():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "帧采样缓存"})
        ).json()
        base = f"/v1/video-editor/projects/{project['id']}"
        added = await client.post(
            f"{base}/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": "add-color",
                "operations": [
                    {
                        "type": "addClip",
                        "clip": {
                            "id": "color",
                            "trackId": "visual-1",
                            "kind": "color",
                            "name": "画面",
                            "color": "#ff0000",
                            "timelineStartUs": 0,
                            "durationUs": 1_000_000,
                        },
                    }
                ],
            },
        )
        assert added.status_code == 200, added.text
        derived = (
            AssetStorage(get_settings()).project_root(
                "video-editor", project["id"], owner_user_id="test-user"
            )
            / "derived"
        )
        legacy = derived / f"frame-v{TEXT_RENDER_VERSION}-chroma2-r1-t0-w320-rawnone.png"
        legacy.write_bytes(b"stale-sampling-frame")
        old_compositor = derived / (
            f"frame-v{TEXT_RENDER_VERSION}-chroma2-sample{VIDEO_SAMPLING_VERSION}"
            "-r1-t0-w320-rawnone.png"
        )
        old_compositor.write_bytes(b"stale-eyelid-mask")
        response = await client.get(f"{base}/preview/frame?revision=1&timeUs=0&width=320")
        assert response.status_code == 200, response.text
        assert response.content.startswith(b"\x89PNG\r\n\x1a\n")
        assert legacy.read_bytes() == b"stale-sampling-frame"
        assert old_compositor.read_bytes() == b"stale-eyelid-mask"
        current = derived / (
            f"frame-v{TEXT_RENDER_VERSION}-composite{FRAME_COMPOSITOR_VERSION}"
            f"-chroma2-sample{VIDEO_SAMPLING_VERSION}"
            "-r1-t0-w320-rawnone.png"
        )
        assert current.read_bytes() == response.content
