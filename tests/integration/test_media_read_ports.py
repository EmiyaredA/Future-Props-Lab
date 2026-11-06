"""One media use case works unchanged with memory, SQLite and HTTP source adapters."""

import asyncio
import io
from contextlib import asynccontextmanager
from dataclasses import replace

import httpx
import pytest
from PIL import Image
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from studio.apps.asset_library.settings import StorageSettings
from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.media_sources import StoredMediaSources
from studio.apps.asset_library.storage.models import VisualAsset, VisualAssetFolder
from studio.apps.media_rendering.clients.media_sources import RemoteMediaSources
from studio.apps.media_rendering.previews import MediaPreviews
from studio.apps.media_rendering.processing import LocalMediaProcessor
from studio.apps.media_rendering.settings import RenderingSettings
from studio.apps.media_rendering.use_cases.read_media import ReadMedia
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.media_content import MediaDescription
from studio.contracts.media_rendering.image_crop import ImageCropIn
from studio.runtime.files.borrowed_media import materialized_media
from studio.runtime.http.capability_client import CapabilityDenied

DESCRIPTION = MediaDescription("picture", 3, "owner", "image", "image/png", "picture.png")
CROP = ImageCropIn(x=1, y=1, width=3, height=2)


class MemoryContent:
    def __init__(self, data, description=DESCRIPTION):
        self.description, self.stream = description, io.BytesIO(data)

    async def read(self, size=-1):
        return self.stream.read(size)


class Access:
    active = True

    async def ensure_active(self):
        if not self.active:
            raise AssetError("revoked", code="source_authorization_revoked", status=401)


@pytest.fixture
def png():
    data = io.BytesIO()
    Image.new("RGBA", (8, 6), (100, 20, 30, 120)).save(data, "PNG")
    return data.getvalue()


@pytest.fixture(params=["memory", "sqlite", "http"])
async def sources(request, tmp_path, png):
    if request.param == "memory":

        class Sources:
            @asynccontextmanager
            async def borrow(self, owner, asset_id):
                if (owner, asset_id) != ("owner", "picture"):
                    raise AssetError("missing", code="not_found", status=404)
                content = MemoryContent(png)
                try:
                    yield content
                finally:
                    content.stream.close()

        yield Sources()
        return
    if request.param == "http":

        class Capabilities:
            @asynccontextmanager
            async def file_source(self, *, assertion, source_method, source_path, asset_id):
                assert (assertion, source_method, source_path) == ("verified", "POST", "/crop")
                if asset_id != "picture":
                    raise CapabilityDenied(404)
                yield httpx.Response(
                    200,
                    content=png,
                    headers={
                        "X-Fpl-File-Revision": "3",
                        "X-Fpl-File-Kind": "image",
                        "Content-Type": "image/png",
                        "Content-Length": str(len(png)),
                        "Content-Disposition": 'inline; filename="picture.png"',
                    },
                )

        yield RemoteMediaSources(
            settings=RenderingSettings(tmp_path / "render.db"),
            capabilities=Capabilities(),
            owner="owner",
            assertion="verified",
            method="POST",
            path="/crop",
        )
        assert not list(tmp_path.glob("accounts/*/.tmp/inputs/*"))
        return
    engine = create_async_engine("sqlite+aiosqlite:///" + str(tmp_path / "assets.db"))
    sessions = async_sessionmaker(engine)
    storage = AssetStorage(StorageSettings(tmp_path / "assets.db"))
    try:
        async with engine.begin() as connection:
            for table in (VisualAssetFolder.__table__, VisualAsset.__table__):
                await connection.run_sync(table.create)
        async with sessions() as session:
            row = VisualAsset(
                id="picture",
                owner_user_id="owner",
                storage_key="picture.png",
                storage_version=2,
                original_filename="picture.png",
                display_name="Picture",
                media_kind="image",
                mime_type="image/png",
                byte_size=len(png),
                revision=3,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            path = storage.path_for(row)
            path.parent.mkdir(parents=True)
            path.write_bytes(png)
        yield StoredMediaSources(sessions, storage)
        assert path.read_bytes() == png
    finally:
        await engine.dispose()


@pytest.fixture
def processor(tmp_path):
    settings = RenderingSettings(tmp_path / "render.db")
    return LocalMediaProcessor(MediaPreviews(settings), root=tmp_path / "staged", maximum=4096)


async def test_crop_and_missing_input_have_one_contract(sources, processor):
    use_case = ReadMedia(sources, processor, Access())
    result = await use_case.crop("owner", "picture", CROP)
    with Image.open(io.BytesIO(result)) as image:
        assert image.size == (3, 2) and image.getpixel((0, 0)) == (100, 20, 30, 120)
    with pytest.raises((AssetError, CapabilityDenied)) as missing:
        await use_case.crop("owner", "missing", CROP)
    assert missing.value.status == 404
    with pytest.raises(AssetError) as foreign:
        await use_case.crop("other", "picture", CROP)
    assert foreign.value.status == 404
    with pytest.raises(AssetError):
        await use_case.video_info("owner", "picture")


async def test_revocation_discards_finished_derivation(sources, processor):
    access = Access()
    access.active = False
    with pytest.raises(AssetError) as denied:
        await ReadMedia(sources, processor, access).crop("owner", "picture", CROP)
    assert denied.value.status == 401


async def test_cancelled_processing_releases_every_source(sources):
    entered = asyncio.Event()
    borrowed = []

    class BlockingProcessor:
        async def crop(self, source, _body):
            borrowed.append(source)
            entered.set()
            await asyncio.Future()

    task = asyncio.create_task(
        ReadMedia(sources, BlockingProcessor(), Access()).crop("owner", "picture", CROP)
    )
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    with pytest.raises((ValueError, RuntimeError)):
        await borrowed[0].read(1)


async def test_mismatched_owner_never_reaches_processor(png):
    class Sources:
        @asynccontextmanager
        async def borrow(self, *_args):
            content = MemoryContent(png, replace(DESCRIPTION, owner_user_id="someone-else"))
            try:
                yield content
            finally:
                content.stream.close()

    class NeverProcess:
        async def crop(self, *_args):
            raise AssertionError("foreign bytes must not be processed")

    with pytest.raises(AssetError) as denied:
        await ReadMedia(Sources(), NeverProcess(), Access()).crop("owner", "picture", CROP)
    assert denied.value.status == 404


async def test_stream_staging_is_cleaned_on_cancellation_and_limit(tmp_path, png):
    entered = asyncio.Event()

    async def operation():
        async with materialized_media(MemoryContent(png), root=tmp_path, maximum=4096) as path:
            assert path.read_bytes() == png
            entered.set()
            await asyncio.Future()

    task = asyncio.create_task(operation())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not list(tmp_path.iterdir())
    with pytest.raises(AssetError) as oversized:
        async with materialized_media(MemoryContent(png), root=tmp_path, maximum=1):
            raise AssertionError("over-limit input must never reach processor")
    assert oversized.value.status == 413
    assert not list(tmp_path.iterdir())
