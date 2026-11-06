"""Derived outputs release resources on revocation, disconnect and response completion."""

import asyncio
import io
from contextlib import asynccontextmanager

import pytest

from studio.apps.media_rendering.use_cases.read_media import ReadMedia
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.media_content import MediaDescription
from studio.contracts.media_rendering.video_frames import VideoFramesIn
from studio.runtime.files.media_output import FileMediaOutput
from studio.runtime.http.media_response import media_response


class MemoryOutput:
    filename, media_type, byte_size = "frames.zip", "application/zip", 5
    closed = False

    def open(self):
        return io.BytesIO(b"media")

    def close(self):
        self.closed = True


@pytest.fixture(params=["memory", "file"])
def output(request, tmp_path):
    if request.param == "memory":
        return MemoryOutput()
    directory = tmp_path / "frames-unique"
    directory.mkdir()
    path = directory / "frames.zip"
    path.write_bytes(b"media")
    return FileMediaOutput(path, "application/zip", temporary=True)


@pytest.mark.parametrize("failure", [None, RuntimeError, asyncio.CancelledError])
async def test_output_lifecycle_is_independent_of_response_transport(output, failure):
    sent = []

    async def send(message):
        if failure and message["type"] == "http.response.body":
            raise failure()
        sent.append(message)

    async def receive():
        await asyncio.Future()

    response = media_response(output, download=True)
    scope = {
        "type": "http",
        "method": "GET",
        "headers": [],
        "asgi": {"spec_version": "2.4"},
        "extensions": {"http.response.pathsend": {}},
    }
    if failure:
        with pytest.raises(failure):
            await response(scope, receive, send)
    else:
        await response(scope, receive, send)
        assert b"".join(item.get("body", b"") for item in sent) == b"media"
    assert output.closed
    if isinstance(output, FileMediaOutput):
        assert not output.path.parent.exists()


@pytest.mark.parametrize("failure", [AssetError("revoked", status=401), asyncio.CancelledError()])
async def test_completed_output_is_discarded_if_authorization_fails(output, failure):
    class Source:
        description = MediaDescription("video", 4, "owner", "video", "video/mp4", "video.mp4")

    class Sources:
        @asynccontextmanager
        async def borrow(self, *_args):
            yield Source()

    class Processor:
        async def frames(self, *_args):
            return output

    class Access:
        async def ensure_active(self):
            raise failure

    with pytest.raises(type(failure)):
        await ReadMedia(Sources(), Processor(), Access()).frames(
            "owner", "video", VideoFramesIn(positions_ms=[0])
        )
    assert output.closed
    if isinstance(output, FileMediaOutput):
        assert not output.path.parent.exists()
