from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest

from app.tool_navigation import video_download as vd
from website_test_support import app


def test_validate_video_url_accepts_douyin_and_bilibili() -> None:
    assert vd.validate_video_url("https://www.bilibili.com/video/BV1xx411c7mD").endswith(
        "BV1xx411c7mD"
    )
    assert vd.validate_video_url("https://b23.tv/abcd1234").startswith("https://")
    assert vd.validate_video_url("https://www.douyin.com/video/7123456789").endswith("7123456789")
    assert vd.validate_video_url("https://v.douyin.com/abc123/").startswith("https://")


def test_extract_video_url_from_share_text_and_modal() -> None:
    share = (
        "5.15 10/07 :6pm x@s.Rx 【漂泊监狱】第二集 "
        "https://v.douyin.com/u32i-u6Sa3U/ 复制此链接，打开Dou音搜索，直接观看视频！"
    )
    assert vd.extract_video_url(share) == "https://v.douyin.com/u32i-u6Sa3U/"
    assert (
        vd.extract_video_url("https://www.douyin.com/jingxuan?modal_id=7686880989229927732")
        == "https://www.douyin.com/video/7686880989229927732"
    )


def test_validate_video_url_rejects_other_hosts() -> None:
    with pytest.raises(vd.VideoDownloadError, match="仅支持"):
        vd.validate_video_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    with pytest.raises(vd.VideoDownloadError, match="有效"):
        vd.validate_video_url("ftp://www.bilibili.com/video/BV1")


def test_network_hint_prefers_fresh_cookies_over_generic_403() -> None:
    message = vd._network_hint(
        "WARNING: Failed HTTP Error 403: Forbidden\n"
        "ERROR: Fresh cookies (not necessarily logged in) are needed"
    )
    assert "需要登录" in message
    assert "Cookie" in message
    assert "brew upgrade yt-dlp" not in message


def test_douyin_sign_and_stream_pick() -> None:
    from app.tool_navigation import video_download_douyin as douyin

    signed = douyin.sign_detail_query(
        "7693736628409355530",
        uifid="abc",
        timestamp="1710000000",
    )
    assert signed["aweme_id"] == "7693736628409355530"
    assert signed["uifid"] == "abc"
    assert signed["timestamp"] == "1710000000"
    assert len(signed["x-secsdk-web-signature"]) == 32

    video = {
        "bit_rate": [
            {
                "play_addr": {
                    "width": 720,
                    "height": 1280,
                    "url_list": ["https://cdn.example/720.mp4"],
                }
            },
            {
                "play_addr": {
                    "width": 576,
                    "height": 1024,
                    "url_list": ["https://cdn.example/540.mp4"],
                }
            },
        ],
        "play_addr": {
            "width": 720,
            "height": 1280,
            "url_list": ["https://cdn.example/play.mp4"],
        },
    }
    url, width, height = douyin.pick_stream(video, quality="best")
    assert url.endswith("720.mp4")
    assert width == 720 and height == 1280
    capped, *_rest = douyin.pick_stream(video, quality="480")
    assert capped.endswith("540.mp4")


def test_job_create_requires_destination() -> None:
    with pytest.raises(ValueError, match="至少选择"):
        vd.VideoDownloadJobCreate(
            url="https://www.bilibili.com/video/BV1xx411c7mD",
            save_to_disk=False,
            save_to_library=False,
        )


@pytest.mark.asyncio
async def test_deps_and_job_lifecycle(monkeypatch, tmp_path: Path) -> None:
    def fake_probe() -> vd.VideoDownloadDepsOut:
        return vd.VideoDownloadDepsOut(
            ready=True,
            yt_dlp=vd.BinaryStatus(
                name="yt-dlp", ok=True, path="/bin/yt-dlp", version="2026.01.01"
            ),
            ffmpeg=vd.BinaryStatus(name="ffmpeg", ok=True, path="/bin/ffmpeg", version="ffmpeg 7"),
        )

    async def fake_run(
        *, url: str, quality: str, work_dir: Path, cookies_from_browser: str | None
    ) -> None:
        assert "bilibili.com" in url
        assert quality == "720"
        assert cookies_from_browser == "chrome"
        media = work_dir / "clip.mp4"
        # Minimal ISO BMFF so looks_like accepts .mp4 when library path is used.
        media.write_bytes(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64)
        (work_dir / "clip.info.json").write_text(
            json.dumps({"title": "测试视频", "webpage_url": url}, ensure_ascii=False),
            encoding="utf-8",
        )

    async def fake_ingest(job: vd.VideoDownloadJob, media: Path) -> vd.VideoDownloadAssetOut:
        assert job.quality == "720"
        assert media.is_file()
        return vd.VideoDownloadAssetOut(
            id="asset-1",
            display_name="测试视频",
            original_filename=media.name,
            mime_type="video/mp4",
            byte_size=media.stat().st_size,
        )

    downloads = vd.VideoDownloads(
        root=tmp_path, download=fake_run, ingest=fake_ingest, probe=fake_probe
    )
    monkeypatch.setattr(app.state, "video_downloads", downloads)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        deps = await client.get("/v1/tool-navigation/video-download/deps")
        assert deps.status_code == 200
        assert deps.json()["ready"] is True

        created = await client.post(
            "/v1/tool-navigation/video-download/jobs",
            json={
                "url": "https://www.bilibili.com/video/BV1xx411c7mD",
                "quality": "720",
                "use_browser_cookies": True,
                "cookies_from_browser": "chrome",
                "save_to_disk": True,
                "save_to_library": True,
            },
        )
        assert created.status_code == 200, created.text
        job_id = created.json()["id"]

        for _ in range(40):
            status = await client.get(f"/v1/tool-navigation/video-download/jobs/{job_id}")
            assert status.status_code == 200
            payload = status.json()
            if payload["status"] in {"succeeded", "failed"}:
                break
            await asyncio.sleep(0.05)
        else:
            pytest.fail("job did not finish")

        assert payload["status"] == "succeeded"
        assert payload["title"] == "测试视频"
        assert payload["asset"]["id"] == "asset-1"
        assert payload["filename"].endswith(".mp4")

        download = await client.get(f"/v1/tool-navigation/video-download/jobs/{job_id}/file")
        assert download.status_code == 200
        assert download.content.startswith(b"\x00\x00\x00\x18ftyp")

        rejected = await client.post(
            "/v1/tool-navigation/video-download/jobs",
            json={
                "url": "https://example.com/video",
                "save_to_disk": True,
                "save_to_library": False,
            },
        )
        assert rejected.status_code == 422


@pytest.mark.asyncio
async def test_missing_deps_block_job_creation(monkeypatch) -> None:
    monkeypatch.setattr(
        app.state.video_downloads,
        "probe",
        lambda: vd.VideoDownloadDepsOut(
            ready=False,
            yt_dlp=vd.BinaryStatus(name="yt-dlp", ok=False, hint="安装 yt-dlp"),
            ffmpeg=vd.BinaryStatus(name="ffmpeg", ok=True, path="/bin/ffmpeg", version="ok"),
        ),
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/tool-navigation/video-download/jobs",
            json={
                "url": "https://www.bilibili.com/video/BV1xx411c7mD",
                "save_to_disk": True,
                "save_to_library": False,
            },
        )
        assert response.status_code == 422
        body = response.json()
        message = body.get("message") or body.get("detail")
        if isinstance(message, dict):
            message = message.get("message", str(message))
        assert "yt-dlp" in str(message)
