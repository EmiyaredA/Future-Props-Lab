"""Real private file previews, bounded decoding and atomic revisioned derivatives."""

import asyncio
import io
import json
import subprocess
import zipfile
from contextlib import AsyncExitStack
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image
from pypdf import PdfWriter
from tests.test_account_system import create_test_account, login_and_change_password, unsafe_headers

from app.capabilities.media_rendering import preview_metadata as file_previews
from app.capabilities.media_rendering import preview_metadata as preview_operations
from app.capabilities.media_rendering.preview_metadata import media_thumbnail
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.media_content import MediaDescription
from website_test_support import app

pytestmark = [pytest.mark.asyncio, pytest.mark.real_auth]


@pytest.fixture
async def clients():
    async with AsyncExitStack() as stack:
        result = []
        for _ in range(2):
            username, password = await create_test_account()
            client = await stack.enter_async_context(
                httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
            )
            await login_and_change_password(client, username, password)
            client.headers.update(unsafe_headers(client))
            result.append(client)
        yield result


async def upload(client, name, data, mime):
    result = await client.post("/v1/files", files={"upload": (name, data, mime)})
    assert result.status_code == 200, result.text
    return result.json()


def pdf_bytes(encrypted=False):
    writer = PdfWriter()
    writer.add_blank_page(width=320, height=160)
    writer.add_blank_page(width=160, height=320)
    if encrypted:
        writer.encrypt("private-test-password")
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


async def test_pdf_pages_are_rendered_and_remain_private_on_cache_hits(clients):
    owner, other = clients
    row = await upload(owner, "pages.pdf", pdf_bytes(), "application/pdf")
    base = f"/v1/files/{row['id']}"
    metadata = await owner.get(base + "/preview")
    assert metadata.status_code == 200, metadata.text
    assert metadata.json()["kind"] == "pdf"
    assert metadata.json()["page_count"] == 2
    assert metadata.headers["cache-control"] == "private, no-store"
    for page, dimensions in [(1, (320, 160)), (2, (160, 320))]:
        response = await owner.get(base + f"/thumbnail?size=320&page={page}")
        assert response.status_code == 200, response.text
        with Image.open(io.BytesIO(response.content)) as image:
            assert image.size == dimensions
        assert response.headers["cache-control"] == "private, no-store"
        assert (await other.get(base + f"/thumbnail?page={page}")).status_code == 404
    assert (await other.get(base + "/preview")).status_code == 404
    assert (await owner.get(base + "/thumbnail?page=0")).status_code == 422
    assert (await owner.get(base + "/thumbnail?page=3")).status_code == 422
    assert (await owner.get(base + "/thumbnail?size=999")).status_code == 422
    assert (await owner.get(base + "/content")).content == pdf_bytes()


async def test_scanned_pdf_keeps_real_page_pixels(clients):
    image = Image.new("RGB", (120, 80), (210, 40, 50))
    buffer = io.BytesIO()
    image.save(buffer, format="PDF")
    row = await upload(clients[0], "scan.pdf", buffer.getvalue(), "application/pdf")
    response = await clients[0].get(f"/v1/files/{row['id']}/thumbnail?size=128")
    assert response.status_code == 200, response.text
    with Image.open(io.BytesIO(response.content)) as rendered:
        r, g, _b = rendered.convert("RGB").getpixel((30, 30))
        assert r > 180 and g < 70


@pytest.mark.parametrize(
    "suffix,mime",
    [
        ("txt", "text/plain"),
        ("md", "text/markdown"),
        ("json", "application/json"),
        ("csv", "text/csv"),
    ],
)
async def test_text_documents_are_bounded_and_do_not_interpret_html(clients, suffix, mime):
    owner, _ = clients
    text = "<script>unsafe()</script> 中文内容\n" * 5000
    data = (json.dumps({"text": text}, ensure_ascii=False) if suffix == "json" else text).encode()
    row = await upload(owner, f"text.{suffix}", data, mime)
    response = await owner.get(f"/v1/files/{row['id']}/preview")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "text" and body["truncated"]
    assert "<script>unsafe()</script> 中文内容" in body["text"]
    assert len(body["text"].encode()) <= preview_operations.TEXT_LIMIT
    assert "�" not in body["text"]


async def test_empty_utf16_and_gb18030_documents(tmp_path):
    for data, expected in [
        (b"", ""),
        ("中文说明".encode("utf-16"), "中文说明"),
        ("中文说明".encode("gb18030"), "中文说明"),
    ]:
        source = tmp_path / "notes.txt"
        source.write_bytes(data)
        assert preview_operations._text_preview(source).text == expected


async def test_encrypted_and_broken_pdf_can_be_downloaded(clients):
    for content in [pdf_bytes(True), b"%PDF-1.7\ninvalid pdf"]:
        row = await upload(clients[0], "unreadable.pdf", content, "application/pdf")
        base = f"/v1/files/{row['id']}"
        assert (await clients[0].get(base + "/preview")).status_code == 422
        assert (await clients[0].get(base + "/thumbnail")).status_code == 422
        assert (await clients[0].get(base + "/download")).content == content


async def test_real_video_frame_short_fallback_and_audio_waveform(clients, tmp_path):
    owner, other = clients
    for seconds in (0.2, 2):
        video = tmp_path / f"clip-{seconds}.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=160x90:r=10",
                "-t",
                str(seconds),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(video),
            ],
            check=True,
        )
        row = await upload(owner, video.name, video.read_bytes(), "video/mp4")
        base = f"/v1/files/{row['id']}"
        metadata = (await owner.get(base + "/preview")).json()
        assert metadata["kind"] == "video" and metadata["duration_seconds"] > 0
        response = await owner.get(base + "/thumbnail?size=128")
        assert response.status_code == 200, response.text
        with Image.open(io.BytesIO(response.content)) as image:
            assert image.width == 128 and image.height <= 128
            assert image.convert("RGB").getpixel((20, 20))[0] > 200
        assert (await other.get(base + "/thumbnail")).status_code == 404
        body = {"positions_ms": [0, 100], "max_width": 128}
        frames = await owner.post(base + "/frames", json=body)
        assert frames.status_code == 200, frames.text
        with zipfile.ZipFile(io.BytesIO(frames.content)) as archive:
            assert len(archive.namelist()) == 2
            for name in archive.namelist():
                with Image.open(io.BytesIO(archive.read(name))) as frame:
                    assert frame.width == 128 and frame.getpixel((20, 20))[0] > 200
        assert (await other.post(base + "/frames", json=body)).status_code == 404
        assert not list(app.state.settings.runtime_path.glob("accounts/*/.tmp/outputs/frames-*"))
    audio = tmp_path / "sound.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=65",
            str(audio),
        ],
        check=True,
    )
    row = await upload(owner, audio.name, audio.read_bytes(), "audio/wav")
    base = f"/v1/files/{row['id']}"
    metadata = (await owner.get(base + "/preview")).json()
    assert metadata["waveform_seconds"] == 60
    assert metadata["duration_seconds"] == pytest.approx(65, abs=0.1)
    response = await owner.get(base + "/thumbnail?size=320")
    assert response.status_code == 200, response.text
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.width == 320
        assert image.convert("RGBA").getextrema()[3] == (0, 255)
    assert (await other.get(base + "/preview")).status_code == 404


async def test_atomic_concurrent_generation_revision_and_timeout_cleanup(tmp_path, monkeypatch):
    source = tmp_path / "input.pdf"
    source.write_bytes(pdf_bytes())
    settings = SimpleNamespace(account_path=lambda owner: tmp_path / owner)
    info = MediaDescription("file", 1, "owner", "document", "application/pdf", "input.pdf")
    targets = await asyncio.gather(
        *(media_thumbnail(settings, info, source, 128, 1) for _ in range(4))
    )
    assert len(set(targets)) == 1
    assert targets[0].is_file()
    changed = await media_thumbnail(settings, replace(info, revision=2), source, 128, 1)
    assert changed != targets[0]
    with pytest.raises(AssetError):
        await media_thumbnail(settings, info, source, 128, 4)

    async def timed_out(*_args):
        raise TimeoutError()

    monkeypatch.setattr(preview_operations, "pdf_worker", timed_out)
    with pytest.raises(AssetError, match="预览生成失败"):
        await media_thumbnail(settings, replace(info, revision=3), source, 128, 1)
    assert not list((tmp_path / "owner").rglob("*.tmp"))
    assert not list((tmp_path / "owner").rglob("3-*.webp"))


async def test_pdf_timeout_and_cancellation_terminate_worker(tmp_path, monkeypatch):
    class Process:
        returncode = None
        killed = False
        waited = False

        async def communicate(self):
            await asyncio.Event().wait()

        def kill(self):
            self.killed = True
            self.returncode = -9

        async def wait(self):
            self.waited = True

    processes = []

    async def spawn(*_args, **_kwargs):
        process = Process()
        processes.append(process)
        return process

    monkeypatch.setattr(preview_operations.asyncio, "create_subprocess_exec", spawn)
    monkeypatch.setattr(preview_operations, "PDF_TIMEOUT_SECONDS", 0.01)
    with pytest.raises(TimeoutError):
        await preview_operations.pdf_worker(tmp_path / "any.pdf", "info")
    assert processes[-1].killed and processes[-1].waited

    monkeypatch.setattr(preview_operations, "PDF_TIMEOUT_SECONDS", 30)
    task = asyncio.create_task(preview_operations.pdf_worker(tmp_path / "any.pdf", "info"))
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert processes[-1].killed and processes[-1].waited


async def test_corrupt_derived_metadata_is_rebuilt_from_original(tmp_path):
    source = tmp_path / "notes.md"
    source.write_text("实际正文", encoding="utf-8")
    settings = SimpleNamespace(account_path=lambda owner: tmp_path / owner)
    info = MediaDescription("notes", 1, "owner", "document", "text/markdown", "notes.md")

    result = await file_previews.describe_preview(settings, info, source)
    assert result.text == "实际正文"
    cached = file_previews.cache_root(settings, info) / "1-preview-v1.json"
    cached.write_text("damaged derived json", encoding="utf-8")
    recovered = await file_previews.describe_preview(settings, info, source)
    assert recovered == result
