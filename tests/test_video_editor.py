from __future__ import annotations

import io
import json
import math
import struct
import subprocess
import threading
import wave
from pathlib import Path

import httpx
import pytest
from PIL import Image
from sqlalchemy import delete

from app.main import app
from app.apps.video_editor.models import VideoEditorProject
from app.runtime.db import SessionLocal
from app.apps.video_editor.schemas import VideoEditorTimelineDocument
from app.apps.video_editor.evaluator import FrameSource, TimelineFrameRenderer, property_at, visual_gaps
from app.apps.video_editor.render_engine import render_document
from app.apps.video_editor.runner import VideoEditorRunner


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
        timeline = (await client.get(f"/v1/video-editor/projects/{project['id']}/timeline")).json()
        assert timeline["revision"] == 0
        assert [track["kind"] for track in timeline["document"]["tracks"]] == [
            "visual",
            "mixed",
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


@pytest.mark.asyncio
async def test_video_editor_asset_organization_validation_and_delete_cleanup() -> None:
    await _reset()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "素材编排"})
        ).json()
        asset_ids: list[str] = []
        for filename in ("scene-a.png", "scene-b.png"):
            image = io.BytesIO()
            Image.new("RGB", (16, 16), "#674fd1").save(image, format="PNG")
            response = await client.post(
                f"/v1/video-editor/projects/{project['id']}/assets",
                files={"upload": (filename, image.getvalue(), "image/png")},
            )
            assert response.status_code == 200, response.text
            asset_ids.append(response.json()["id"])

        organization = {
            "folders": [{"id": "folder-scenes", "name": " 场景 ", "assetIds": [asset_ids[0]]}],
            "rootAssetIds": [asset_ids[1]],
        }
        saved = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": "organize-assets-1",
                "operations": [{"type": "setAssetOrganization", "organization": organization}],
            },
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["document"]["assetOrganization"] == {
            "folders": [{"id": "folder-scenes", "name": "场景", "assetIds": [asset_ids[0]]}],
            "rootAssetIds": [asset_ids[1]],
        }

        duplicate = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations",
            json={
                "expectedRevision": 1,
                "requestId": "organize-assets-duplicate",
                "operations": [
                    {
                        "type": "setAssetOrganization",
                        "organization": {
                            "folders": [
                                {
                                    "id": "folder-scenes",
                                    "name": "场景",
                                    "assetIds": [asset_ids[0]],
                                }
                            ],
                            "rootAssetIds": [asset_ids[0]],
                        },
                    }
                ],
            },
        )
        assert duplicate.status_code == 422
        duplicate_name = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations",
            json={
                "expectedRevision": 1,
                "requestId": "organize-folders-duplicate-name",
                "operations": [
                    {
                        "type": "setAssetOrganization",
                        "organization": {
                            "folders": [
                                {"id": "folder-a", "name": "场景", "assetIds": []},
                                {"id": "folder-b", "name": "场景", "assetIds": []},
                            ],
                            "rootAssetIds": asset_ids,
                        },
                    }
                ],
            },
        )
        assert duplicate_name.status_code == 422

        other = (await client.post("/v1/video-editor/projects", json={"title": "其他工程"})).json()
        other_image = io.BytesIO()
        Image.new("RGB", (16, 16), "#222222").save(other_image, format="PNG")
        foreign_asset = (
            await client.post(
                f"/v1/video-editor/projects/{other['id']}/assets",
                files={"upload": ("foreign.png", other_image.getvalue(), "image/png")},
            )
        ).json()
        foreign = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations",
            json={
                "expectedRevision": 1,
                "requestId": "organize-assets-foreign",
                "operations": [
                    {
                        "type": "setAssetOrganization",
                        "organization": {
                            "folders": [],
                            "rootAssetIds": [foreign_asset["id"]],
                        },
                    }
                ],
            },
        )
        assert foreign.status_code == 422
        assert foreign.json()["code"] == "invalid_asset"

        deleted = await client.delete(
            f"/v1/video-editor/projects/{project['id']}/assets/{asset_ids[0]}"
        )
        assert deleted.status_code == 200, deleted.text
        timeline = (await client.get(f"/v1/video-editor/projects/{project['id']}/timeline")).json()
        assert timeline["revision"] == 2
        assert timeline["document"]["assetOrganization"]["folders"][0]["assetIds"] == []
        used = await client.post(
            f"/v1/video-editor/projects/{project['id']}/timeline/operations",
            json={
                "expectedRevision": 2,
                "requestId": "organize-assets-used",
                "operations": [
                    {
                        "type": "addClip",
                        "clip": {
                            "id": "organized-image",
                            "trackId": "visual-1",
                            "kind": "image",
                            "name": "scene-b",
                            "timelineStartUs": 0,
                            "durationUs": 1_000_000,
                            "sourceInUs": 0,
                            "assetId": asset_ids[1],
                        },
                    }
                ],
            },
        )
        assert used.status_code == 200, used.text
        blocked = await client.delete(
            f"/v1/video-editor/projects/{project['id']}/assets/{asset_ids[1]}"
        )
        assert blocked.status_code == 422
        assert blocked.json()["code"] == "asset_in_use"
        unchanged = (await client.get(f"/v1/video-editor/projects/{project['id']}/timeline")).json()
        assert unchanged["revision"] == 3
        assert unchanged["document"]["assetOrganization"]["rootAssetIds"] == [asset_ids[1]]


@pytest.mark.asyncio
async def test_video_editor_media_is_copied_and_proxy_metadata_is_retryable() -> None:
    await _reset()
    image = io.BytesIO()
    Image.new("RGB", (640, 360), "#674fd1").save(image, format="PNG")
    payload = image.getvalue()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (await client.post("/v1/video-editor/projects", json={"title": "素材"})).json()
        upload = await client.post(
            f"/v1/video-editor/projects/{project['id']}/assets",
            files={"upload": ("frame.png", payload, "image/png")},
        )
        assert upload.status_code == 200
        asset_id = upload.json()["id"]
        assert upload.json()["processingStatus"] == "queued"
        await VideoEditorRunner().process_once()
        listed = (await client.get(f"/v1/video-editor/projects/{project['id']}/assets")).json()
        asset = next(item for item in listed["items"] if item["id"] == asset_id)
        assert asset["processingStatus"] == "ready"
        assert asset["thumbnailUrl"]
        thumbnail = await client.get(asset["thumbnailUrl"])
        assert thumbnail.status_code == 200
        assert thumbnail.headers["content-type"].startswith("image/png")

        source = (
            await client.post(
                "/v1/files",
                files={"upload": ("library.png", payload, "image/png")},
            )
        ).json()
        imported = await client.post(
            f"/v1/video-editor/projects/{project['id']}/assets/import",
            json={"assetIds": [source["id"]]},
        )
        assert imported.status_code == 200
        imported_id = imported.json()["items"][0]["id"]
        assert imported_id != source["id"]
        deleted = await client.delete(
            f"/v1/files/{source['id']}", params={"expected_revision": source["revision"]}
        )
        assert deleted.status_code == 200
        copied_content = await client.get(f"/v1/files/{imported_id}/content")
        assert copied_content.content == payload


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


def test_video_editor_cover_fit_fills_canvas_without_letterboxing() -> None:
    clip = {
        **color_clip("portrait", 0, 1_000_000),
        "kind": "image",
        "name": "portrait",
        "assetId": "portrait",
        "color": None,
        "fitMode": "cover",
    }
    document = VideoEditorTimelineDocument.model_validate(
        {
            "settings": {"width": 1920, "height": 1080, "backgroundColor": "#000000"},
            "tracks": [
                {
                    "id": "visual-1",
                    "kind": "visual",
                    "name": "V1",
                    "order": 0,
                    "clips": [clip],
                }
            ],
        }
    )
    portrait = Image.new("RGBA", (400, 800), (220, 40, 30, 255))
    frame = TimelineFrameRenderer(
        document,
        FrameSource(
            image_for_clip=lambda _clip, _time: portrait.copy(),
            font_for_clip=lambda _clip: None,
        ),
    ).render(0)

    assert frame.getpixel((0, 0)) == (220, 40, 30)
    assert frame.getpixel((1919, 1079)) == (220, 40, 30)


def test_video_editor_frame_evaluator_honors_bottom_anchor_and_brightness() -> None:
    clip = {
        **color_clip("portrait", 0, 1_000_000),
        "kind": "image",
        "name": "portrait",
        "assetId": "portrait",
        "color": None,
        "fitMode": "native",
        "transform": {
            "x": 100,
            "y": 100,
            "anchor": "bottomCenter",
            "scaleX": 1,
            "scaleY": 1,
            "rotation": 0,
            "opacity": 1,
            "brightness": 0.5,
        },
    }
    document = VideoEditorTimelineDocument.model_validate(
        {
            "settings": {"width": 1920, "height": 1080, "fps": 30},
            "tracks": [
                {
                    "id": "visual-1",
                    "kind": "visual",
                    "name": "V1",
                    "order": 0,
                    "clips": [clip],
                }
            ],
        }
    )
    portrait = Image.new("RGBA", (10, 10), (200, 100, 50, 255))
    frame = TimelineFrameRenderer(
        document,
        FrameSource(
            image_for_clip=lambda _clip, _time: portrait.copy(),
            font_for_clip=lambda _clip: None,
        ),
    ).render(0)
    assert frame.getpixel((99, 99)) == (100, 50, 25)
    assert frame.getpixel((99, 100)) == (0, 0, 0)


def test_video_editor_height_fitted_portrait_grounds_visible_alpha_bottom() -> None:
    clip = {
        **color_clip("portrait", 0, 1_000_000),
        "kind": "image",
        "name": "portrait",
        "assetId": "portrait",
        "color": None,
        "fitMode": "height",
        "heightPercent": 10,
        "transform": {
            "x": 100,
            "y": 100,
            "anchor": "bottomCenter",
            "scaleX": 1,
            "scaleY": 1,
            "rotation": 0,
            "opacity": 1,
            "brightness": 1,
        },
    }
    document = VideoEditorTimelineDocument.model_validate(
        {
            "settings": {"width": 1920, "height": 1080, "fps": 30},
            "tracks": [
                {
                    "id": "visual-1",
                    "kind": "visual",
                    "name": "V1",
                    "order": 0,
                    "clips": [clip],
                }
            ],
        }
    )
    portrait = Image.new("RGBA", (10, 10), (220, 40, 30, 255))
    portrait.paste((0, 0, 0, 0), (0, 7, 10, 10))
    frame = TimelineFrameRenderer(
        document,
        FrameSource(
            image_for_clip=lambda _clip, _time: portrait.copy(),
            font_for_clip=lambda _clip: None,
        ),
    ).render(0)
    meaningful_rows = [y for y in range(150) if frame.getpixel((99, y))[0] >= 8]
    assert max(meaningful_rows) >= 98
    assert frame.getpixel((99, 100)) == (0, 0, 0)


def test_video_editor_text_layer_keeps_large_chinese_glyph_bottom_padding() -> None:
    clip = {
        **color_clip("ending-title", 0, 1_000_000),
        "kind": "text",
        "name": "谢谢观看",
        "text": "谢谢观看",
        "fontSize": 108,
        "textColor": "#f4e7c5",
        "fontAssetId": "ending-font",
        "color": None,
    }
    document = VideoEditorTimelineDocument.model_validate(
        {
            "settings": {"width": 1920, "height": 1080, "fps": 30},
            "tracks": [
                {
                    "id": "visual-1",
                    "kind": "visual",
                    "name": "V1",
                    "order": 0,
                    "clips": [clip],
                }
            ],
        }
    )
    font_path = (
        Path(__file__).parents[1]
        / "backend/app/capabilities/media_rendering/assets/NotoSansSC-Medium.ttf"
    )
    renderer = TimelineFrameRenderer(
        document,
        FrameSource(
            image_for_clip=lambda _clip, _time: None,
            font_for_clip=lambda _clip: font_path,
        ),
    )

    layer = renderer._text_layer(document.tracks[0].clips[0])
    alpha_bounds = layer.getchannel("A").getbbox()

    assert alpha_bounds is not None
    assert alpha_bounds[1] >= 10
    assert alpha_bounds[3] <= layer.height - 10


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


def test_video_editor_audio_source_offset_is_rebased_to_pts_zero(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    rate = 48_000
    with wave.open(str(source), "wb") as output:
        output.setparams((1, 2, rate, rate * 2, "NONE", "not compressed"))
        samples = []
        for index in range(rate * 2):
            value = (
                0 if index < rate else round(12_000 * math.sin(2 * math.pi * 440 * index / rate))
            )
            samples.append(struct.pack("<h", value))
        output.writeframes(b"".join(samples))
    document = VideoEditorTimelineDocument.model_validate(
        {
            "settings": {"width": 1920, "height": 1080, "fps": 30},
            "tracks": [
                {
                    "id": "visual-1",
                    "kind": "visual",
                    "name": "V1",
                    "order": 0,
                    "clips": [color_clip("black", 0, 200_000)],
                },
                {
                    "id": "audio-1",
                    "kind": "audio",
                    "name": "A1",
                    "order": 1,
                    "clips": [
                        {
                            "id": "audio",
                            "trackId": "audio-1",
                            "kind": "audio",
                            "name": "trimmed",
                            "timelineStartUs": 0,
                            "durationUs": 200_000,
                            "sourceInUs": 1_000_000,
                            "assetId": "source",
                        }
                    ],
                },
            ],
        }
    )
    rendered = tmp_path / "trimmed.mp4"
    render_document(
        document,
        {"source": source},
        rendered,
        preset="720p30",
        start_us=0,
        end_us=200_000,
        cancel=threading.Event(),
        progress=lambda _value: None,
    )
    decoded = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(rendered),
            "-map",
            "0:a:0",
            "-f",
            "s16le",
            "-ac",
            "1",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    ).stdout
    values = struct.unpack(f"<{len(decoded) // 2}h", decoded)
    assert max(abs(value) for value in values) > 500
