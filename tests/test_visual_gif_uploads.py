import asyncio
import io
import json
import subprocess
from unittest.mock import AsyncMock

import httpx
import pytest
from PIL import Image

from app.apps.visual_workshop.outputs import video_uploads
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.animated_image import gif_to_mp4
from app.main import app
from app.runtime.config import get_settings


def animation():
    stream = io.BytesIO()
    frames = [Image.new("RGB", (17, 19), color) for color in ("red", "green", "blue")]
    frames[0].save(
        stream,
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        duration=[100, 200, 300],
        loop=0,
    )
    return stream.getvalue()


def transparent_animation():
    stream = io.BytesIO()
    frames = []
    for color in range(1, 4):
        image = Image.new("P", (17, 19), 0)
        image.putpalette([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255] + [0] * 756)
        image.paste(color, (4, 4, 12, 15))
        frames.append(image)
    frames[0].save(
        stream,
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        duration=[100, 200, 300],
        loop=0,
        transparency=0,
        disposal=2,
    )
    return stream.getvalue()


async def create_node(client, kind="video"):
    project = (
        await client.post("/v1/visual-workshop/projects", json={"title": "GIF", "kind": "canvas"})
    ).json()["id"]
    path = f"/v1/visual-workshop/projects/{project}"
    response = await client.put(
        path + "/canvas",
        json={
            "expected_revision": 0,
            "nodes": [{"id": "dance", "kind": kind, "title": "舞蹈", "position": {"x": 0, "y": 0}}],
            "edges": [],
        },
    )
    assert response.status_code == 200, response.text
    return project, path, response.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["video", "image"])
async def test_gif_output_upload_retains_animation_and_matching_asset_kind(kind, tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project, path, canvas = await create_node(client, kind)
        response = await client.post(
            path + "/nodes/dance/output-uploads",
            data={"expected_revision": canvas["revision"]},
            files={"file": ("dance.GIF", animation(), "application/octet-stream")},
        )
        assert response.status_code == 200, response.text
        saved = response.json()
        node = saved["nodes"][0]
        assert node["kind"] == kind and node["final_version"] == 1
        assert saved["revision"] == canvas["revision"] + 1
        assert (await client.get(path + "/canvas")).json() == saved
        history = (await client.get(path + "/nodes/dance/outputs")).json()["items"]
        assert len(history) == 1
        assert history[0]["kind"] == kind and history[0]["source"] == "uploaded"
        assert history[0]["is_final"]
        assets = (await client.get("/v1/files", params={"project_id": project})).json()["items"]
        assert len(assets) == (2 if kind == "video" else 1)
        asset = next(item for item in assets if item["id"] == node["asset_id"])
        assert asset["id"] == node["asset_id"]
        assert asset["media_kind"] == kind
        assert asset["mime_type"] == ("video/mp4" if kind == "video" else "image/gif")
        content = await client.get(f"/v1/files/{asset['id']}/content")
        assert content.status_code == 200, content.text
        if kind == "image":
            assert content.content == animation()
        else:
            assert asset["original_filename"] == "dance.mp4"
            video = tmp_path / "uploaded.mp4"
            video.write_bytes(content.content)
            probe = json.loads(
                subprocess.check_output(
                    [
                        "ffprobe",
                        "-v",
                        "error",
                        "-show_streams",
                        "-show_format",
                        "-of",
                        "json",
                        str(video),
                    ]
                )
            )
            assert [s["codec_type"] for s in probe["streams"]] == ["video"]
            assert (probe["streams"][0]["width"], probe["streams"][0]["height"]) == (18, 20)
            assert float(probe["format"]["duration"]) == pytest.approx(0.6, abs=0.02)
            decoded = subprocess.check_output(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    str(video),
                    "-fps_mode",
                    "passthrough",
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    "rgb24",
                    "pipe:1",
                ]
            )
            frame_size = 18 * 20 * 3
            assert len(decoded) == 60 * frame_size
            assert decoded[0] > 240
            assert decoded[10 * frame_size + 1] > 110
            assert decoded[30 * frame_size + 2] > 240
            assert decoded[59 * frame_size + 2] > 240


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure",
    [
        "corrupt",
        "header_only",
        "dimensions",
        "oversize",
        "unavailable",
        "timeout",
        "conflict",
        "audio",
    ],
)
async def test_failed_gif_upload_preserves_canvas_and_leaves_no_assets(failure, monkeypatch):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project, path, canvas = await create_node(
            client, "audio" if failure == "audio" else "video"
        )
        data = animation()
        expected_status = 422
        if failure == "corrupt":
            data = b"not a gif"
        elif failure == "header_only":
            data = animation()[:10]
        elif failure == "dimensions":
            data = data[:6] + (8193).to_bytes(2, "little") + data[8:]
        elif failure == "oversize":
            monkeypatch.setattr(get_settings(), "fpl_visual_asset_max_bytes", 10)
            expected_status = 413
        elif failure in {"unavailable", "timeout"}:
            monkeypatch.setattr(
                video_uploads,
                "gif_to_mp4",
                AsyncMock(
                    side_effect=FileNotFoundError() if failure == "unavailable" else TimeoutError()
                ),
            )
            expected_status = 503 if failure == "unavailable" else 422
        elif failure == "conflict":
            expected_status = 409
        response = await client.post(
            path + "/nodes/dance/output-uploads",
            data={"expected_revision": 0 if failure == "conflict" else canvas["revision"]},
            files={"file": ("dance.gif", data, "image/gif")},
        )
        assert response.status_code == expected_status, response.text
        assert (await client.get(path + "/canvas")).json() == canvas
        assert (await client.get(path + "/nodes/dance/outputs")).json()["items"] == []
        assert (await client.get("/v1/files", params={"project_id": project})).json()["items"] == []


@pytest.mark.asyncio
async def test_concurrent_canvas_edit_during_conversion_wins_without_orphan_file(monkeypatch):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project, path, canvas = await create_node(client)
        newer = None

        async def convert(source, target, *, max_bytes):
            nonlocal newer
            await gif_to_mp4(source, target, max_bytes=max_bytes)
            changed = dict(canvas["nodes"][0], title="用户的新标题")
            response = await client.put(
                path + "/canvas",
                json={"expected_revision": canvas["revision"], "nodes": [changed], "edges": []},
            )
            assert response.status_code == 200, response.text
            newer = response.json()

        monkeypatch.setattr(video_uploads, "gif_to_mp4", convert)
        response = await client.post(
            path + "/nodes/dance/output-uploads",
            data={"expected_revision": canvas["revision"]},
            files={"file": ("dance.gif", animation(), "image/gif")},
        )
        assert response.status_code == 409, response.text
        assert (await client.get(path + "/canvas")).json() == newer
        assert (await client.get("/v1/files", params={"project_id": project})).json()["items"] == []
        assert (await client.get(path + "/nodes/dance/outputs")).json()["items"] == []
        root = (
            AssetStorage(get_settings()).project_root(
                "visual-workshop", project, owner_user_id="test-user"
            )
            / "assets"
        )
        assert not [p for p in root.rglob("*") if p.is_file()]


@pytest.mark.asyncio
async def test_conversion_cancellation_kills_encoder_and_removes_partial_file(
    tmp_path, monkeypatch
):
    target = tmp_path / "partial.mp4"
    target.write_bytes(b"partial")
    process = AsyncMock()
    process.returncode = None
    process.kill = lambda: setattr(process, "returncode", -9)
    process.wait.side_effect = [asyncio.CancelledError(), -9]
    monkeypatch.setattr(asyncio, "create_subprocess_exec", AsyncMock(return_value=process))
    with pytest.raises(asyncio.CancelledError):
        await gif_to_mp4(tmp_path / "input.gif", target, max_bytes=10000)
    assert process.returncode == -9
    assert not target.exists()


@pytest.mark.asyncio
async def test_transparent_gif_is_composited_over_black(tmp_path):
    source, target = tmp_path / "transparent.gif", tmp_path / "video.mp4"
    image = Image.new("RGBA", (32, 32), (255, 255, 255, 0))
    for x in range(16, 32):
        for y in range(32):
            image.putpixel((x, y), (255, 0, 0, 255))
    image.save(source, duration=100)
    await gif_to_mp4(source, target, max_bytes=1_000_000)
    decoded = subprocess.check_output(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(target),
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ]
    )
    assert max(decoded[(16 * 32 + 4) * 3 : (16 * 32 + 4) * 3 + 3]) < 5
    assert decoded[(16 * 32 + 24) * 3] > 240


@pytest.mark.asyncio
async def test_conversion_output_limit_removes_partial_video(tmp_path):
    source, target = tmp_path / "source.gif", tmp_path / "video.mp4"
    source.write_bytes(animation())
    with pytest.raises(OverflowError):
        await gif_to_mp4(source, target, max_bytes=100)
    assert not target.exists()


@pytest.mark.asyncio
async def test_transparent_inspection_video_metadata_pixels_and_snapshot(tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project, path, canvas = await create_node(client)
        response = await client.post(
            path + "/nodes/dance/output-uploads",
            data={"expected_revision": canvas["revision"]},
            files={"file": ("transparent.gif", transparent_animation(), "image/gif")},
        )
        assert response.status_code == 200, response.text
        history = (await client.get(path + "/nodes/dance/outputs")).json()["items"][0]
        asset, inspection = history["asset_id"], history["inspection_asset_id"]
        assert asset != inspection and response.json()["nodes"][0]["asset_id"] == asset
        canonical_info = (await client.get(f"/v1/files/{asset}/media-info")).json()
        inspection_info = (await client.get(f"/v1/files/{inspection}/media-info")).json()
        assert canonical_info == {
            "container": "MP4",
            "codec": "h264",
            "pixel_format": "yuv420p",
            "alpha_channel": "absent",
        }
        assert inspection_info["container"] == "WebM" and inspection_info["codec"] == "vp9"
        assert inspection_info["alpha_channel"] == "present"
        content = (await client.get(f"/v1/files/{inspection}/content")).content
        video = tmp_path / "inspection.webm"
        video.write_bytes(content)
        probe = json.loads(
            subprocess.check_output(
                ["ffprobe", "-v", "error", "-show_format", "-of", "json", str(video)]
            )
        )
        assert float(probe["format"]["duration"]) == pytest.approx(0.6, abs=0.02)
        rgba = subprocess.check_output(
            [
                "ffmpeg",
                "-v",
                "error",
                "-c:v",
                "libvpx-vp9",
                "-i",
                str(video),
                "-fps_mode",
                "passthrough",
                "-pix_fmt",
                "rgba",
                "-f",
                "rawvideo",
                "pipe:1",
            ]
        )
        frame_size = 18 * 20 * 4
        assert len(rgba) == 60 * frame_size
        for frame in range(60):
            start = frame * frame_size
            assert rgba[start + 3] == 0
            assert rgba[start + (8 * 18 + 8) * 4 + 3] == 255
            assert rgba[start + (19 * 18 + 17) * 4 + 3] == 0
        # The three held frames retain their timing and final colour.
        for frame, channel in [(0, 0), (9, 0), (10, 1), (29, 1), (30, 2), (59, 2)]:
            assert rgba[frame * frame_size + (8 * 18 + 8) * 4 + channel] > 230
        protected = await client.delete(f"/v1/files/{inspection}", params={"expected_revision": 0})
        assert protected.status_code == 409
        snapshot = await client.get(path + "/snapshot")
        assert snapshot.status_code == 200, snapshot.text
        restored = await client.post(
            "/v1/visual-workshop/projects/snapshot-imports",
            files={"file": ("transparent.zip", snapshot.content, "application/zip")},
        )
        assert restored.status_code == 200, restored.text
        copied = "/v1/visual-workshop/projects/" + restored.json()["project"]["id"]
        copied_node = (await client.get(copied + "/canvas")).json()["nodes"][0]
        copied_history = (await client.get(copied + f"/nodes/{copied_node['id']}/outputs")).json()[
            "items"
        ][0]
        copied_inspection = copied_history["inspection_asset_id"]
        assert copied_inspection != inspection
        assert (await client.get(f"/v1/files/{copied_inspection}/content")).content == content


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["inspection_conversion", "second_store"])
async def test_inspection_failure_leaves_no_output_or_files(failure, monkeypatch):
    from app.capabilities.asset_store.library import AssetError, AssetLibrary

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project, path, canvas = await create_node(client)
        if failure == "inspection_conversion":
            monkeypatch.setattr(
                video_uploads, "gif_to_webm", AsyncMock(side_effect=ValueError("透明转换失败"))
            )
        else:
            store = AssetLibrary.store_upload

            async def fail_second(self, upload, **kwargs):
                if upload.content_type == "video/webm":
                    raise AssetError("透明素材保存失败")
                assert kwargs["defer_persistence"]
                assert not self.session.in_transaction()
                return await store(self, upload, **kwargs)

            monkeypatch.setattr(AssetLibrary, "store_upload", fail_second)
        result = await client.post(
            path + "/nodes/dance/output-uploads",
            data={"expected_revision": canvas["revision"]},
            files={"file": ("transparent.gif", transparent_animation(), "image/gif")},
        )
        assert result.status_code == 422, result.text
        assert (await client.get(path + "/canvas")).json() == canvas
        assert (await client.get(path + "/nodes/dance/outputs")).json()["items"] == []
        assert (await client.get("/v1/files", params={"project_id": project})).json()["items"] == []
        assert not [
            p
            for p in (
                AssetStorage(get_settings()).project_root(
                    "visual-workshop", project, owner_user_id="test-user"
                )
                / "assets"
            ).rglob("*")
            if p.is_file()
        ]
