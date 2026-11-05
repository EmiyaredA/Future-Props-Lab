"""Download lifecycle owns accepted work and rejects cross-account access."""

import asyncio
from types import SimpleNamespace

import pytest

from app.tool_navigation.video_download import VideoDownloads
from app.tool_navigation.video_download_contracts import VideoDownloadJobCreate
from app.tool_navigation.video_download_errors import VideoDownloadError


async def test_shutdown_drains_before_storage_closes_and_instances_are_isolated(tmp_path):
    entered, finish = asyncio.Event(), asyncio.Event()
    stored = []

    async def download(*, work_dir, **_kwargs):
        entered.set()
        await finish.wait()
        (work_dir / "video.mp4").write_bytes(b"controlled-test-video")

    async def ingest(job, media):
        stored.append((job.owner_user_id, media.read_bytes()))

    first = VideoDownloads(
        root=tmp_path / "first",
        download=download,
        ingest=ingest,
        probe=lambda: SimpleNamespace(ready=True),
    )
    second = VideoDownloads(
        root=tmp_path / "second",
        download=download,
        ingest=ingest,
        probe=lambda: SimpleNamespace(ready=True),
    )
    command = VideoDownloadJobCreate(
        url="https://www.bilibili.com/video/BV1xx411c7mD",
        save_to_disk=True,
        save_to_library=True,
    )
    job = first.create_job(command, owner_user_id="owner")
    await entered.wait()
    closing = asyncio.create_task(first.close())
    try:
        await asyncio.sleep(0)
        assert not closing.done()
        with pytest.raises(VideoDownloadError) as rejected:
            first.create_job(command, owner_user_id="owner")
        assert rejected.value.code == "service_stopping"
        for runtime, owner in ((first, "other"), (second, "owner")):
            with pytest.raises(VideoDownloadError) as missing:
                runtime.get_job(job.id, owner_user_id=owner)
            assert missing.value.status == 404
        finish.set()
        await asyncio.wait_for(closing, 1)
        assert stored == [("owner", b"controlled-test-video")]
        assert first.get_job(job.id, owner_user_id="owner").status == "succeeded"
        assert not second.jobs
    finally:
        finish.set()
        await first.close()
        await second.close()
