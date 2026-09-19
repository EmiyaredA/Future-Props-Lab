from __future__ import annotations

import io
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

import httpx
import pytest
from PIL import Image

from app.apps.motion_compositor.models import MotionTask
from app.apps.motion_compositor.projects import MotionNotFound, MotionProjects
from app.apps.motion_compositor.runner import MotionExportRunner
from app.apps.video_editor.runner import VideoEditorRunner
from app.capabilities.media_rendering.motion_document import MotionComposition
from app.capabilities.media_rendering.motion_frames import MotionFrameRenderer
from app.main import app
from app.runtime.db import SessionLocal


@pytest.mark.asyncio
async def test_motion_project_cas_isolation_and_multiformat_export() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post("/v1/motion-compositor/projects", json={"title": "测试合成"})
        assert created.status_code == 200, created.text
        project_id = created.json()["id"]
        base = f"/v1/motion-compositor/projects/{project_id}"
        async with SessionLocal() as session:
            with pytest.raises(MotionNotFound):
                await MotionProjects(session, "other-workspace").get(project_id)

        upload = Image.new("RGBA", (32, 32), (240, 40, 60, 255))
        buffer = io.BytesIO()
        upload.save(buffer, format="PNG")
        asset_response = await client.post(
            f"{base}/assets", files={"file": ("sprite.png", buffer.getvalue(), "image/png")}
        )
        assert asset_response.status_code == 200, asset_response.text
        asset_id = asset_response.json()["id"]
        document = (await client.get(f"{base}/document")).json()["document"]
        document["settings"]["durationFrames"] = 2
        document["layers"] = [
            {
                "id": "sprite",
                "name": "人物",
                "kind": "image",
                "assetId": asset_id,
                "width": 80,
                "height": 80,
                "startFrame": 0,
                "endFrame": 2,
                "transform": {"x": 100, "y": 100},
                "mask": {
                    "points": [
                        {"x": 0, "y": 0},
                        {"x": 40, "y": 0},
                        {"x": 40, "y": 80},
                        {"x": 0, "y": 80},
                    ],
                    "keyframes": [
                        {
                            "frame": 1,
                            "points": [
                                {"x": 40, "y": 0},
                                {"x": 80, "y": 0},
                                {"x": 80, "y": 80},
                                {"x": 40, "y": 80},
                            ],
                        }
                    ],
                },
            }
        ]
        edit = {
            "expectedRevision": 0,
            "requestId": "motion-test-edit-1",
            "operations": [{"type": "replaceDocument", "document": document}],
        }
        first = await client.post(f"{base}/document/operations", json=edit)
        assert first.status_code == 200, first.text
        assert first.json()["revision"] == 1
        repeated = await client.post(f"{base}/document/operations", json=edit)
        assert repeated.status_code == 200
        assert repeated.json() == first.json()
        stale = await client.post(
            f"{base}/document/operations", json={**edit, "requestId": "motion-test-edit-2"}
        )
        assert stale.status_code == 409
        assert stale.json()["current_revision"] == 1

        alpha_frames = []
        for frame in (0, 1):
            response = await client.get(f"{base}/preview/frame", params={"frame": frame})
            assert response.status_code == 200, response.text
            alpha_frames.append(Image.open(io.BytesIO(response.content)).convert("RGBA"))
        assert alpha_frames[0].getpixel((85, 100))[3] > 0
        assert alpha_frames[0].getpixel((115, 100))[3] == 0
        assert alpha_frames[1].getpixel((85, 100))[3] == 0
        assert alpha_frames[1].getpixel((115, 100))[3] > 0

        export = await client.post(
            f"{base}/exports",
            json={
                "expectedRevision": 1,
                "requestId": "motion-test-export-1",
                "formats": ["mp4", "mov4444", "png-sequence"],
                "startFrame": 0,
                "endFrame": 2,
            },
        )
        assert export.status_code == 200, export.text
        task_id = export.json()["id"]
        await MotionExportRunner().process_once()
        task = (await client.get(f"{base}/exports/{task_id}")).json()
        assert task["status"] == "completed", task
        assert set(task["outputs"]) == {"mp4", "mov4444", "png-sequence"}
        png_zip = await client.get(f"{base}/exports/{task_id}/download/png-sequence")
        assert png_zip.status_code == 200
        with zipfile.ZipFile(io.BytesIO(png_zip.content)) as archive:
            assert len(archive.namelist()) == 2
            assert (
                archive.read("alpha-000000.png")
                == (await client.get(f"{base}/preview/frame", params={"frame": 0})).content
            )
        mov = await client.get(f"{base}/exports/{task_id}/download/mov4444")
        assert mov.status_code == 200
        with tempfile.TemporaryDirectory(prefix="motion-probe-") as temporary:
            mov_path = Path(temporary) / "alpha.mov"
            mov_path.write_bytes(mov.content)
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=pix_fmt",
                    "-of",
                    "json",
                    str(mov_path),
                ],
                capture_output=True,
                check=True,
            )
        assert json.loads(probe.stdout)["streams"][0]["pix_fmt"].startswith("yuva")
        mp4 = await client.get(f"{base}/exports/{task_id}/download/mp4")
        assert mp4.status_code == 200
        assert mp4.content
        handoff = await client.post(
            f"{base}/exports/{task_id}/video-editor-handoffs",
            json={
                "format": "mov4444",
                "newProjectTitle": "测试交接剪辑",
            },
        )
        assert handoff.status_code == 200, handoff.text
        editor_id = handoff.json()["projectId"]
        timeline = await client.get(f"/v1/video-editor/projects/{editor_id}/timeline")
        assert timeline.status_code == 200
        assert any(
            track["order"] == 0
            and clip.get("assetId") == handoff.json()["assetId"]
            and clip["timelineStartUs"] == 0
            for track in timeline.json()["document"]["tracks"]
            for clip in track["clips"]
        )
        await VideoEditorRunner().process_once()
        editor_assets = await client.get(f"/v1/video-editor/projects/{editor_id}/assets")
        assert editor_assets.status_code == 200, editor_assets.text
        imported = next(
            item
            for item in editor_assets.json()["items"]
            if item["id"] == handoff.json()["assetId"]
        )
        assert imported["processingStatus"] == "ready", imported
        assert imported["proxyUrl"].endswith("/proxy")
        proxy = await client.get(imported["proxyUrl"])
        assert proxy.status_code == 200
        with tempfile.TemporaryDirectory(prefix="motion-proxy-") as temporary:
            proxy_path = Path(temporary) / "proxy.webm"
            frame_path = Path(temporary) / "proxy.png"
            proxy_path.write_bytes(proxy.content)
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-c:v",
                    "libvpx-vp9",
                    "-i",
                    str(proxy_path),
                    "-frames:v",
                    "1",
                    "-y",
                    str(frame_path),
                ],
                check=True,
                capture_output=True,
            )
            with Image.open(frame_path) as preview:
                alpha = preview.convert("RGBA").getchannel("A")
                assert alpha.getpixel((0, 0)) == 0
                assert alpha.getpixel((45, 50)) > 0
        deleted = await client.delete(base, params={"expectedRevision": 0})
        assert deleted.status_code == 200, deleted.text


def test_motion_keyframes_follow_layer_start_frame() -> None:
    document = MotionComposition.model_validate(
        {
            "settings": {"width": 1920, "height": 1080, "fps": 30, "durationFrames": 20},
            "layers": [
                {
                    "id": "moving",
                    "name": "移动图形",
                    "kind": "shape",
                    "shape": "rect",
                    "width": 40,
                    "height": 40,
                    "fill": "#ffffff",
                    "startFrame": 10,
                    "endFrame": 20,
                    "transform": {"x": 100, "y": 100},
                    "keyframes": [
                        {"id": "start", "frame": 0, "property": "x", "value": 100},
                        {"id": "end", "frame": 5, "property": "x", "value": 200},
                    ],
                }
            ],
        }
    )
    renderer = MotionFrameRenderer(document, {})
    assert renderer.render(0).getbbox() is None
    assert renderer.render(10).getpixel((100, 100))[3] == 255
    assert renderer.render(15).getpixel((200, 100))[3] == 255


@pytest.mark.asyncio
async def test_motion_project_archive_remaps_assets() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = (
            await client.post("/v1/motion-compositor/projects", json={"title": "可移植工程"})
        ).json()
        base = f"/v1/motion-compositor/projects/{created['id']}"
        source = Image.new("RGBA", (10, 10), "#d72536")
        encoded = io.BytesIO()
        source.save(encoded, format="PNG")
        asset = (
            await client.post(
                f"{base}/assets",
                files={"file": ("original.png", encoded.getvalue(), "image/png")},
            )
        ).json()
        document = (await client.get(f"{base}/document")).json()["document"]
        document["layers"] = [
            {
                "id": "art",
                "name": "原图",
                "kind": "image",
                "assetId": asset["id"],
                "width": 10,
                "height": 10,
                "endFrame": 180,
                "transform": {"x": 20, "y": 20},
            }
        ]
        changed = await client.post(
            f"{base}/document/operations",
            json={
                "expectedRevision": 0,
                "requestId": "archive-edit-001",
                "operations": [{"type": "replaceDocument", "document": document}],
            },
        )
        assert changed.status_code == 200, changed.text
        archive = await client.get(f"{base}/snapshot")
        assert archive.status_code == 200
        imported = await client.post(
            "/v1/motion-compositor/projects/snapshot-imports",
            files={"file": ("portable.zip", archive.content, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        other = f"/v1/motion-compositor/projects/{imported.json()['id']}"
        copied = (await client.get(f"{other}/document")).json()["document"]
        assert copied["layers"][0]["assetId"] != asset["id"]
        assert (await client.get(f"{other}/preview/frame", params={"frame": 0})).content == (
            await client.get(f"{base}/preview/frame", params={"frame": 0})
        ).content
        assert (await client.delete(other, params={"expectedRevision": 0})).status_code == 200
        assert (await client.delete(base, params={"expectedRevision": 0})).status_code == 200


@pytest.mark.asyncio
async def test_motion_export_recovers_interrupted_task() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = (
            await client.post("/v1/motion-compositor/projects", json={"title": "任务恢复"})
        ).json()
        base = f"/v1/motion-compositor/projects/{created['id']}"
        exported = await client.post(
            f"{base}/exports",
            json={
                "expectedRevision": 0,
                "requestId": "motion-recover-001",
                "formats": ["png-sequence"],
                "startFrame": 0,
                "endFrame": 1,
            },
        )
        assert exported.status_code == 200, exported.text
        task_id = exported.json()["id"]
        async with SessionLocal() as session:
            task = await session.get(MotionTask, task_id)
            assert task is not None
            task.status = "running"
            task.progress = 75
            await session.commit()
        await MotionExportRunner().recover()
        recovered = (await client.get(f"{base}/exports/{task_id}")).json()
        assert recovered["status"] == "queued"
        assert recovered["progress"] == 0
        assert (await client.delete(base, params={"expectedRevision": 0})).status_code == 200
