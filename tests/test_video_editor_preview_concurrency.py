from __future__ import annotations

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from PIL import Image

from app.apps.video_editor import frames
from app.apps.video_editor.schemas import VideoEditorTimelineDocument
from app.capabilities.media_rendering.contracts import RenderPlan
from app.main import app


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
            return b"preview" if preview_kind == "frame" else Image.new("RGBA", (8, 8))
        finally:
            finished.set()

    monkeypatch.setattr(
        frames, "render_plan_frame" if preview_kind == "frame" else "render_text_layer", slow_render
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
