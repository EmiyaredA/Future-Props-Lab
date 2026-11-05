import io
import wave

import httpx
import pytest
from tests.test_audio_annotation import upload_audio
from tests.thought_helpers import create_note

from website_test_support import app


@pytest.fixture
async def owned_annotations():
    identities = []
    yield identities
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for identity in identities:
            url = f"/v1/audio-annotation/projects/{identity}"
            current = await client.get(url)
            assert current.status_code == 200, current.text
            deleted = await client.delete(
                url, params={"expected_revision": current.json()["revision"]}
            )
            assert deleted.status_code == 200, deleted.text


@pytest.mark.asyncio
async def test_thought_conversion_edit_export_and_revision_conflict():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        converted = await client.post(
            "/v1/thought-workshop/markdown/convert",
            json={
                "markdown": "# Heading\n\nA **bold** statement\n\n- [x] done\n- next\n\n"
                "|A|B|\n|-|-|\n|1|2|\n\n```mermaid\ngraph TD; A-->B\n```",
            },
        )
        assert converted.status_code == 200, converted.text
        note = await create_note(
            client, json={"title": "Conversion", "document": converted.json()["document"]}
        )
        assert note.status_code == 200, note.text
        identity = note.json()["id"]
        url = f"/v1/thought-workshop/notes/{identity}"
        batch = {
            "expected_revision": 0,
            "request_id": "edit-heading",
            "operations": [
                {"action": "replace_text", "path": [0, 0], "start": 0, "end": 7, "text": "Changed"},
            ],
        }
        response = await client.post(url + "/operations", json=batch)
        assert response.status_code == 200, response.text
        assert (await client.post(url + "/operations", json=batch)).json() == response.json()
        assert (
            await client.get(url + "/export", params={"expected_revision": 0})
        ).status_code == 409
        output = await client.get(url + "/export", params={"expected_revision": 1})
        assert output.status_code == 200, output.text
        assert "# Changed" in output.text and "**bold**" in output.text and "[x]" in output.text
        html = await client.get(url + "/export", params={"expected_revision": 1, "format": "html"})
        assert html.status_code == 200 and "<strong>bold</strong>" in html.text
        rejected = await client.post(
            "/v1/thought-workshop/markdown/convert",
            json={"markdown": "![private](x.png)", "assets": {"x.png": "missing"}},
        )
        assert rejected.status_code == 404


@pytest.mark.asyncio
async def test_annotation_split_merge_export_and_server_clip(owned_annotations):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        asset = await upload_audio(client)
        project = (
            await client.post(
                "/v1/audio-annotation/projects", json={"title": "Exports", "asset_id": asset["id"]}
            )
        ).json()
        owned_annotations.append(project["id"])
        url = f"/v1/audio-annotation/projects/{project['id']}"
        doc = (await client.get(url + "/document")).json()
        body = {
            "expected_revision": doc["revision"],
            "request_id": "speakers",
            "operations": [
                *[
                    {"entity": "segment", "action": "remove", "id": segment["id"]}
                    for segment in doc["segments"]
                ],
                {
                    "entity": "speaker",
                    "action": "insert",
                    "id": "s1",
                    "value": {"name": "Speaker", "color": "#123456"},
                },
                {
                    "entity": "segment",
                    "action": "insert",
                    "id": "seg1",
                    "value": {
                        "start_ms": 0,
                        "end_ms": 800,
                        "speaker_id": "s1",
                        "speaker_ids": ["s1"],
                        "text": "Hello",
                    },
                },
            ],
        }
        result = await client.post(url + "/document/operations", json=body)
        assert result.status_code == 200, result.text
        revision = result.json()["revision"]
        srt = await client.get(
            url + "/export", params={"expected_revision": revision, "format": "srt"}
        )
        assert srt.status_code == 200, srt.text
        assert "00:00:00,000 --> 00:00:00,800" in srt.text and "Speaker：Hello" in srt.text
        exported = (
            await client.get(url + "/export", params={"expected_revision": revision})
        ).json()
        assert exported["kind"] == "future-props-audio-annotation"
        clip = await client.get(
            url + "/segments/seg1/audio", params={"expected_revision": revision}
        )
        assert clip.status_code == 200, clip.text
        with wave.open(io.BytesIO(clip.content)) as audio:
            assert abs(audio.getnframes() / audio.getframerate() - 0.8) < 0.01
        split = await client.post(
            url + "/document/operations",
            json={
                "expected_revision": revision,
                "request_id": "split",
                "operations": [
                    {"action": "split", "id": "seg1", "at_ms": 400, "new_id": "seg2"},
                ],
            },
        )
        assert split.status_code == 200, split.text
        assert len(split.json()["segments"]) == 2
        failed = await client.get(
            url + "/export", params={"expected_revision": split.json()["revision"], "format": "srt"}
        )
        assert failed.status_code == 422


@pytest.mark.asyncio
async def test_video_frames_zip_grid_and_invalid_position(tmp_path):
    import subprocess
    import zipfile

    from PIL import Image

    source = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x64:r=10",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        check=True,
        capture_output=True,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        uploaded = await client.post(
            "/v1/files", files={"upload": ("frames.mp4", source.read_bytes(), "video/mp4")}
        )
        assert uploaded.status_code == 200, uploaded.text
        url = f"/v1/files/{uploaded.json()['id']}/frames"
        result = await client.post(url, json={"positions_ms": [0, 400], "max_width": 64})
        assert result.status_code == 200, result.text
        with zipfile.ZipFile(io.BytesIO(result.content)) as archive:
            assert len(archive.namelist()) == 2
            with Image.open(io.BytesIO(archive.read(archive.namelist()[0]))) as frame:
                assert frame.size == (64, 64)
        grid = await client.post(url, json={"positions_ms": [0, 200, 400, 600], "output": "grid"})
        assert grid.status_code == 200, grid.text
        with Image.open(io.BytesIO(grid.content)) as picture:
            assert picture.width >= 128
        invalid = await client.post(url, json={"positions_ms": [5000]})
        assert invalid.status_code == 422, invalid.text
        assert (
            await client.post("/v1/files/missing/frames", json={"positions_ms": [0]})
        ).status_code == 404


@pytest.mark.asyncio
async def test_image_crop_preserves_alpha_and_original():
    from PIL import Image

    image = Image.new("RGBA", (8, 6), (20, 80, 160, 96))
    image.putpixel((3, 2), (255, 0, 0, 0))
    source = io.BytesIO()
    image.save(source, "PNG")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        uploaded = await client.post(
            "/v1/files",
            files={"upload": ("crop.png", source.getvalue(), "image/png")},
        )
        assert uploaded.status_code == 200, uploaded.text
        url = f"/v1/files/{uploaded.json()['id']}"
        cropped = await client.post(url + "/crop", json={"x": 3, "y": 2, "width": 4, "height": 3})
        assert cropped.status_code == 200, cropped.text
        with Image.open(io.BytesIO(cropped.content)) as result:
            assert result.size == (4, 3)
            assert result.getpixel((0, 0)) == (255, 0, 0, 0)
            assert result.getpixel((1, 1)) == (20, 80, 160, 96)
        invalid = await client.post(url + "/crop", json={"x": 3, "y": 2, "width": 8, "height": 3})
        assert invalid.status_code == 422
        assert (await client.get(url + "/download")).content == source.getvalue()
