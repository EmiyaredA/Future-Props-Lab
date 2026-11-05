from unittest.mock import AsyncMock, Mock

import httpx
import pytest

from app.capabilities.media_rendering.media_info import video_info
from app.main import app


@pytest.mark.parametrize(
    "pixel,tags,expected",
    [
        ("yuv420p", {"alpha_mode": "1"}, "present"),
        ("yuv420p", {"ALPHA_MODE": "1"}, "present"),
        ("yuv420p", {}, "absent"),
        ("yuva444p10le", {}, "present"),
        ("rgba", {}, "present"),
        (None, {}, "unknown"),
        ("pal8", {}, "unknown"),
    ],
)
def test_alpha_channel_detection_preserves_webm_alpha_declaration(pixel, tags, expected):
    data = {
        "format": {"format_name": "matroska,webm"},
        "streams": [
            {"codec_type": "video", "codec_name": "vp9", "pix_fmt": pixel, "tags": tags},
        ],
    }
    result = video_info(data, b"\x1aE\xdf\xa3\x42\x82\x84webm")
    assert result == {
        "container": "WebM",
        "codec": "vp9",
        "pixel_format": pixel,
        "alpha_channel": expected,
    }


def test_container_uses_ebml_doctype_instead_of_incidental_strings():
    data = {"format": {"format_name": "matroska,webm"}, "streams": []}
    assert video_info(data, b"\x42\x82\x88matroska title=webm")["container"] == "Matroska"
    assert video_info(data, b"title=webm")["container"] == "Matroska / WebM"


@pytest.mark.asyncio
async def test_media_info_missing_or_cross_workspace_asset_is_not_found(monkeypatch):
    from app.capabilities.asset_store import media_info
    from app.capabilities.asset_store.models import VisualAsset
    from app.orm import bind_owner
    from app.runtime.db import SessionLocal

    async with SessionLocal() as session:
        bind_owner(session, "other-workspace")
        session.add(
            VisualAsset(
                id="other-video-info",
                owner_user_id="other-workspace",
                storage_key="other-video-info",
                original_filename="video.webm",
                display_name="video",
                media_kind="video",
                mime_type="video/webm",
                byte_size=1,
            )
        )
        await session.commit()
    probe = AsyncMock()
    monkeypatch.setattr(media_info, "inspect_video_info", probe)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for asset in ("missing-info", "other-video-info"):
            assert (await client.get(f"/v1/files/{asset}/media-info")).status_code == 404
    probe.assert_not_called()


@pytest.mark.asyncio
async def test_corrupt_and_non_video_media_info_fail_without_mutation():
    from app.capabilities.asset_store.models import VisualAsset
    from app.capabilities.asset_store.storage import AssetStorage
    from app.orm import bind_owner
    from app.runtime.db import SessionLocal
    from studio.config.settings import get_settings

    async with SessionLocal() as session:
        bind_owner(session, "test-user")
        for kind in ("video", "image"):
            asset = VisualAsset(
                id=f"corrupt-info-{kind}",
                owner_user_id="test-user",
                storage_key=f"corrupt-info-{kind}",
                original_filename="corrupt",
                display_name="corrupt",
                media_kind=kind,
                mime_type="video/mp4" if kind == "video" else "image/png",
                byte_size=8,
            )
            session.add(asset)
            await session.flush()
            path = AssetStorage(get_settings()).path_for(asset)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"notmedia")
        await session.commit()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for kind in ("video", "image"):
            response = await client.get(f"/v1/files/corrupt-info-{kind}/media-info")
            assert response.status_code == 422
    async with SessionLocal() as session:
        bind_owner(session, "test-user")
        for kind in ("video", "image"):
            asset = await session.get(VisualAsset, f"corrupt-info-{kind}")
            assert asset.revision == 0 and asset.byte_size == 8


@pytest.mark.asyncio
async def test_probe_cleans_up_on_timeout_or_cancellation(monkeypatch, tmp_path):
    import asyncio

    from app.capabilities.media_rendering import media_info

    for error in (TimeoutError(), asyncio.CancelledError()):
        process = AsyncMock()
        process.returncode = None
        process.kill = Mock()
        process.communicate.side_effect = error
        monkeypatch.setattr(
            media_info.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)
        )
        with pytest.raises(type(error)):
            await media_info.inspect_video_info(tmp_path / "video.webm")
        process.kill.assert_called_once()
        process.wait.assert_awaited_once()
