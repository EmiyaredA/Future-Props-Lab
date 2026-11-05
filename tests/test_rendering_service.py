"""The real media service derives only the authorized HTTP input; it has no asset ORM."""

import io
import json
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image
from pypdf import PdfWriter

from fpl_rendering.application import create_app
from fpl_rendering.migrations.registry import MIGRATIONS
from fpl_rendering.models import GalgameExportJob, MotionRenderJob, VideoExportJob, VideoMediaJob
from fpl_rendering.settings import RenderingSettings
from fpl_runtime.capability_client import CapabilityDenied
from fpl_runtime.claims import Actor, issue_context, verify_context
from fpl_runtime.migrations import apply
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.routing import RouteCatalog

ROOT = Path(__file__).resolve().parents[1]
CATALOG = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")


class Identity:
    active = True

    async def status(self, **_arguments):
        return self.active

    async def close(self):
        pass


class Inputs:
    def __init__(self, public):
        self.public = public
        png = io.BytesIO()
        Image.new("RGBA", (16, 8), (220, 40, 30, 120)).save(png, format="PNG")
        pdf = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=100)
        writer.add_blank_page(width=100, height=200)
        writer.write(pdf)
        self.files = {
            "picture": ("alpha", "image", "image/png", "picture.png", png.getvalue()),
            "document": ("alpha", "document", "application/pdf", "report.pdf", pdf.getvalue()),
            "text": (
                "alpha",
                "document",
                "text/plain",
                "资料.md",
                "正文 <script>safe text</script>".encode(),
            ),
        }
        self.requests = []
        self.extra_headers = {}

    @asynccontextmanager
    async def file_source(self, **arguments):
        self.requests.append(arguments)
        actor = verify_context(
            arguments["assertion"],
            service="rendering",
            method=arguments["source_method"],
            path=arguments["source_path"],
            public_key=self.public,
        )
        row = self.files.get(arguments["asset_id"])
        if row is None or row[0] != actor.user_id:
            raise CapabilityDenied(404)
        _owner, kind, mime, name, body = row
        response = httpx.Response(
            200,
            content=body,
            headers={
                "Content-Type": mime,
                "Content-Length": str(len(body)),
                "Content-Disposition": "inline; filename*=utf-8''" + quote(name),
                "X-Fpl-File-Revision": "3",
                "X-Fpl-File-Kind": kind,
                **self.extra_headers,
            },
        )
        yield response

    async def close(self):
        pass


@pytest.fixture
async def instance(tmp_path):
    private = Ed25519PrivateKey.generate()
    inputs = Inputs(private.public_key())
    identity = Identity()
    apply(tmp_path / "service.db", "rendering", MIGRATIONS)
    app = create_app(
        settings=RenderingSettings(tmp_path / "service.db"),
        public_key=private.public_key(),
        catalog=CATALOG,
        identity=identity,
        capabilities=inputs,
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://rendering"
        ) as client:
            yield app, client, private, inputs, identity


def headers(private, path, method="GET", owner="alpha", service="rendering"):
    return {
        "X-Fpl-Context": issue_context(
            Actor(
                owner,
                "user",
                "session",
                ("studio:read", "studio:private_read", "studio:write"),
                session_id=owner,
            ),
            service=service,
            method=method,
            path=path,
            private_key=private,
            key_id="test",
        )
    }


async def test_media_public_contract_is_unchanged_and_no_asset_table_is_owned(instance):
    app, _client, _private, _inputs, _identity = instance
    original = json.loads((ROOT / "web/src/generated/openapi.json").read_text())
    assert public_contract(app.openapi(), "rendering", CATALOG) == public_contract(
        original, "rendering", CATALOG
    )
    assert app.state.database.models == (
        GalgameExportJob,
        MotionRenderJob,
        VideoMediaJob,
        VideoExportJob,
    )


async def test_owned_image_thumbnail_crop_and_revocation(instance):
    app, client, private, inputs, identity = instance
    path = "/v1/files/picture/thumbnail"
    response = await client.get(path + "?size=128", headers=headers(private, path))
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (16, 8) and image.getpixel((2, 2))[3] == 120
    path = "/v1/files/picture/crop"
    response = await client.post(
        path, headers=headers(private, path, "POST"), json={"x": 1, "y": 1, "width": 4, "height": 3}
    )
    assert response.status_code == 200
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (4, 3)
    assert inputs.requests[-1]["asset_id"] == "picture"
    identity.active = False
    response = await client.get(
        "/v1/files/picture/thumbnail", headers=headers(private, "/v1/files/picture/thumbnail")
    )
    assert response.status_code == 401
    identity.active = None
    response = await client.get(
        "/v1/files/picture/thumbnail", headers=headers(private, "/v1/files/picture/thumbnail")
    )
    assert response.status_code == 503
    assert not list(app.state.settings.account_path("alpha").glob(".tmp/inputs/*"))


async def test_pdf_and_text_previews_use_real_original_content(instance):
    _app, client, private, _inputs, _identity = instance
    for identifier, expected in (("document", "pdf"), ("text", "text")):
        path = f"/v1/files/{identifier}/preview"
        response = await client.get(path, headers=headers(private, path))
        assert response.status_code == 200, response.text
        assert response.json()["kind"] == expected
        if identifier == "document":
            assert response.json()["page_count"] == 2
        else:
            assert "<script>safe text</script>" in response.json()["text"]
    path = "/v1/files/document/thumbnail"
    response = await client.get(path + "?size=128&page=2", headers=headers(private, path))
    assert response.status_code == 200 and response.headers["content-type"] == "image/webp"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (64, 128)
    response = await client.get(path + "?page=3", headers=headers(private, path))
    assert response.status_code == 422


async def test_forged_or_foreign_identity_and_source_headers_fail_closed(instance):
    app, client, private, inputs, _identity = instance
    path = "/v1/files/picture/preview"
    assert (await client.get(path)).status_code == 401
    assert (
        await client.get(path, headers=headers(private, path, service="assets"))
    ).status_code == 401
    assert (await client.get(path, headers=headers(private, path, owner="beta"))).status_code == 404
    inputs.extra_headers["X-Fpl-File-Revision"] = "invalid"
    response = await client.get(path, headers=headers(private, path))
    assert response.status_code == 503
    assert not list(app.state.settings.account_path("alpha").glob(".tmp/inputs/*"))
    for unknown in ("/v1/files", "/v1/model-entries", "/v1/not-real"):
        assert (await client.get(unknown, headers=headers(private, unknown))).status_code == 404


@pytest.mark.parametrize(
    "description,expected",
    [
        ({"Content-Length": "0"}, 503),
        ({"Content-Length": "999999999"}, 413),
        ({"Content-Length": "999"}, 503),
        ({"Content-Length": "1"}, 413),
        ({"X-Fpl-File-Kind": "unknown"}, 503),
        ({"X-Fpl-File-Revision": "-1"}, 503),
    ],
)
async def test_invalid_or_truncated_input_is_rejected_and_temporary_bytes_removed(
    instance, description, expected
):
    app, client, private, inputs, _identity = instance
    inputs.extra_headers.update(description)
    path = "/v1/files/picture/thumbnail"
    response = await client.get(path, headers=headers(private, path))
    assert response.status_code == expected, response.text
    assert not list(app.state.settings.account_path("alpha").glob(".tmp/inputs/*"))
    assert not list(app.state.settings.account_path("alpha").glob("previews/**/*"))


async def test_cancelled_grid_waits_for_writer_before_removing_output(instance, monkeypatch):
    import asyncio
    import threading

    from app.capabilities.asset_store.schemas.video_frames import VideoFramesIn
    from app.capabilities.media_rendering.preview_metadata import PreviewSource
    from fpl_rendering import previews

    app, _client, _private, _inputs, _identity = instance
    started, release = threading.Event(), threading.Event()

    async def extract(_source, target, _position, _width):
        target.write_bytes(b"synthetic frame")

    def render(_paths, _labels, target, _size):
        started.set()
        assert release.wait(timeout=10)
        target.write_bytes(b"finished grid")

    monkeypatch.setattr(previews, "extract_frame", extract)
    monkeypatch.setattr(previews, "render_image_grid", render)
    task = asyncio.create_task(
        app.state.media.frames(
            PreviewSource("video", 0, "alpha", "video", "video/mp4", "clip.mp4"),
            Path("unused synthetic source"),
            VideoFramesIn(positions_ms=[0, 1, 2, 3], output="grid"),
        )
    )
    try:
        async with asyncio.timeout(5):
            while not started.is_set():
                await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.sleep(0.02)
        assert not task.done()
        assert list(app.state.settings.account_path("alpha").glob(".tmp/outputs/frames-*"))
    finally:
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert not list(app.state.settings.account_path("alpha").glob(".tmp/outputs/frames-*"))
