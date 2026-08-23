from __future__ import annotations

import json
import subprocess
import threading
from pathlib import Path

import httpx
import pytest
from PIL import Image
from sqlalchemy import delete

from app.core.db import SessionLocal
from app.main import app
from app.models import VideoEditorProject
from app.schemas.video_editor import VideoEditorTimelineDocument
from app.video_editor.evaluator import FrameSource, TimelineFrameRenderer, property_at, visual_gaps
from app.video_editor.render_engine import render_document


async def _reset() -> None:
    async with SessionLocal() as session:
        await session.execute(delete(VideoEditorProject))
        await session.commit()


def color_clip(clip_id: str, start_us: int, duration_us: int) -> dict:
    return {
        "id": clip_id,
        "trackId": "visual-1",
        "kind": "color",
        "name": "black",
        "timelineStartUs": start_us,
        "durationUs": duration_us,
        "sourceInUs": 0,
        "color": "#000000",
        "fontSize": 72,
        "textColor": "#ffffff",
        "volume": 1,
        "transform": {
            "x": 960,
            "y": 540,
            "scaleX": 1,
            "scaleY": 1,
            "rotation": 0,
            "opacity": 1,
        },
        "keyframes": [],
    }


@pytest.mark.asyncio
async def test_video_editor_timeline_cas_idempotency_and_overlap_validation() -> None:
    await _reset()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project_response = await client.post(
            "/v1/video-editor/projects", json={"title": "确定性剪辑"}
        )
        assert project_response.status_code == 200
        project = project_response.json()
        timeline = (
            await client.get(f"/v1/video-editor/projects/{project['id']}/timeline")
        ).json()
        assert timeline["revision"] == 0
        assert [track["kind"] for track in timeline["document"]["tracks"]] == [
            "visual",
            "audio",
        ]

        body = {
            "expectedRevision": 0,
            "requestId": "request-add-black",
            "operations": [{"type": "addClip", "clip": color_clip("black", 0, 2_000_000)}],
        }
        first = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations", json=body
        )
        assert first.status_code == 200
        assert first.json()["revision"] == 1
        repeated = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations", json=body
        )
        assert repeated.status_code == 200
        assert repeated.json()["revision"] == 1

        stale = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": "request-stale-change",
                "operations": [
                    {"type": "updateTrack", "trackId": "visual-1", "patch": {"name": "V1"}}
                ],
            },
        )
        assert stale.status_code == 409
        assert stale.json()["current_revision"] == 1

        overlap = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations",
            json={
                "expectedRevision": 1,
                "requestId": "request-overlap",
                "operations": [
                    {"type": "addClip", "clip": color_clip("overlap", 1_000_000, 2_000_000)}
                ],
            },
        )
        assert overlap.status_code == 422
        assert overlap.json()["code"] == "clip_overlap"

        preview = await client.post(
            f"/v1/video-editor/projects/{project['id']}/renders/preflight",
            json={"expectedRevision": 1, "preset": "720p30", "startUs": 0},
        )
        assert preview.status_code == 200
        assert preview.json()["ready"] is True
        assert preview.json()["frameCount"] == 60


def test_video_editor_frame_evaluator_interpolates_and_marks_gaps() -> None:
    clip = color_clip("animated", 1_000_000, 2_000_000)
    clip["keyframes"] = [
        {
            "id": "left",
            "property": "opacity",
            "timeUs": 0,
            "value": 0,
            "interpolation": "linear",
        },
        {
            "id": "right",
            "property": "opacity",
            "timeUs": 2_000_000,
            "value": 1,
            "interpolation": "linear",
        },
    ]
    document = VideoEditorTimelineDocument.model_validate(
        {
            "schemaVersion": "1.0",
            "settings": {
                "width": 1920,
                "height": 1080,
                "fps": 30,
                "backgroundColor": "#ffffff",
            },
            "tracks": [
                {
                    "id": "visual-1",
                    "kind": "visual",
                    "name": "V1",
                    "order": 0,
                    "locked": False,
                    "hidden": False,
                    "muted": False,
                    "clips": [clip],
                }
            ],
        }
    )
    parsed_clip = document.tracks[0].clips[0]
    assert property_at(parsed_clip, "opacity", 1_000_000, 1) == pytest.approx(0.5)
    assert visual_gaps(document) == [(0, 1_000_000)]
    frame = TimelineFrameRenderer(
        document,
        FrameSource(image_for_clip=lambda _clip, _time: None, font_for_clip=lambda _clip: None),
    ).render(2_000_000, size=(320, 180))
    assert frame.size == (320, 180)


def test_video_editor_render_is_ffmpeg_native_and_has_exact_tracks(tmp_path: Path) -> None:
    document = VideoEditorTimelineDocument.model_validate(
        {
            "schemaVersion": "1.0",
            "settings": {
                "width": 1920,
                "height": 1080,
                "fps": 30,
                "backgroundColor": "#10131a",
            },
            "tracks": [
                {
                    "id": "visual-1",
                    "kind": "visual",
                    "name": "V1",
                    "order": 0,
                    "locked": False,
                    "hidden": False,
                    "muted": False,
                    "clips": [color_clip("black", 0, 100_000)],
                }
            ],
        }
    )
    output = tmp_path / "output.mp4"
    render_document(
        document,
        {},
        output,
        preset="720p30",
        start_us=0,
        end_us=100_000,
        cancel=threading.Event(),
        progress=lambda _value: None,
    )
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,width,height",
            "-of",
            "json",
            str(output),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    streams = json.loads(probe.stdout)["streams"]
    video = next(stream for stream in streams if stream["codec_type"] == "video")
    audio = next(stream for stream in streams if stream["codec_type"] == "audio")
    assert (video["codec_name"], video["width"], video["height"]) == ("h264", 1280, 720)
    assert audio["codec_name"] == "aac"
    assert output.is_file()
