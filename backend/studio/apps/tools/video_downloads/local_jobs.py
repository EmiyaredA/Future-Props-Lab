"""Download Douyin / Bilibili videos through the local yt-dlp binary."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path

from studio.contracts.tools.video_download import BinaryStatus as BinaryStatus
from studio.contracts.tools.video_download import VideoDownloadAssetOut as VideoDownloadAssetOut
from studio.contracts.tools.video_download import VideoDownloadDepsOut as VideoDownloadDepsOut
from studio.contracts.tools.video_download import VideoDownloadJobCreate as VideoDownloadJobCreate
from studio.contracts.tools.video_download import VideoDownloadJobOut as VideoDownloadJobOut
from studio.contracts.tools.video_errors import VideoDownloadError
from studio.contracts.tools.video_sources import extract_video_url
from studio.contracts.tools.video_sources import validate_video_url as validate_video_url
from studio.host.project_files.video_dependencies import probe_deps as probe_deps
from studio.host.project_files.video_execution import _find_media, _read_title, _safe_filename
from studio.host.project_files.video_execution import _network_hint as _network_hint
from studio.runtime.ids import new_id
from studio.runtime.time import iso_utc, utc_now

BROWSER_CHOICES = ("chrome", "chromium", "edge", "safari", "brave", "firefox")
QUALITY_CHOICES = ("best", "1080", "720", "480")


@dataclass
class VideoDownloadJob:
    id: str
    owner_user_id: str
    url: str
    quality: str
    use_browser_cookies: bool
    cookies_from_browser: str | None
    save_to_disk: bool
    save_to_library: bool
    folder_id: str | None
    work_dir: Path
    status: str = "queued"
    title: str | None = None
    filename: str | None = None
    file_path: Path | None = None
    byte_size: int | None = None
    error: str | None = None
    asset: VideoDownloadAssetOut | None = None
    created_at: str = field(default_factory=lambda: iso_utc(utc_now()))
    updated_at: str = field(default_factory=lambda: iso_utc(utc_now()))

    def touch(self) -> None:
        self.updated_at = iso_utc(utc_now())

    def to_out(self) -> VideoDownloadJobOut:
        return VideoDownloadJobOut(
            id=self.id,
            status=self.status,
            url=self.url,
            quality=self.quality,
            use_browser_cookies=self.use_browser_cookies,
            cookies_from_browser=self.cookies_from_browser,
            save_to_disk=self.save_to_disk,
            save_to_library=self.save_to_library,
            title=self.title,
            filename=self.filename,
            byte_size=self.byte_size,
            error=self.error,
            asset=self.asset,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


class VideoDownloads:
    """Own ephemeral job snapshots and drain accepted work before storage closes.

    Native download and asset ingestion are injected adapters. Shutdown waits for
    native work instead of cancelling its thread while it may still write files.
    """

    def __init__(self, *, root, download, ingest, probe):
        self.root, self.download, self.ingest, self.probe = root, download, ingest, probe
        self.jobs: dict[str, VideoDownloadJob] = {}
        self.tasks: set[asyncio.Task] = set()
        self.closed = False

    async def close(self):
        self.closed = True
        await asyncio.gather(*tuple(self.tasks), return_exceptions=True)

    async def _execute_job(self, job_id: str) -> None:
        job = self.jobs.get(job_id)
        if job is None:
            return
        job.status = "running"
        job.touch()
        try:
            await self.download(
                url=job.url,
                quality=job.quality,
                work_dir=job.work_dir,
                cookies_from_browser=job.cookies_from_browser,
            )
            media = _find_media(job.work_dir)
            title = _read_title(job.work_dir, media.stem)
            download_name = _safe_filename(title, media.suffix.lower())
            renamed = media.with_name(download_name)
            if renamed != media:
                media = media.rename(renamed)
            job.title = title
            job.filename = media.name
            job.file_path = media
            job.byte_size = media.stat().st_size
            if job.save_to_library:
                job.asset = await self.ingest(job, media)
            if not job.save_to_disk:
                # Library copy is durable; drop the temp media when disk export is unused.
                media.unlink(missing_ok=True)
                job.file_path = None
            job.status = "succeeded"
            job.touch()
        except VideoDownloadError as exc:
            job.status = "failed"
            job.error = str(exc)
            job.touch()
        except Exception as exc:  # noqa: BLE001 - surface unexpected failures to the job
            job.status = "failed"
            job.error = f"下载失败：{type(exc).__name__}"
            job.touch()

    def create_job(
        self,
        body: VideoDownloadJobCreate,
        *,
        owner_user_id: str,
    ) -> VideoDownloadJobOut:
        if self.closed:
            raise VideoDownloadError("下载服务正在关闭", code="service_stopping", status=503)
        deps = self.probe()
        if not deps.ready:
            missing = []
            if not deps.yt_dlp.ok:
                missing.append(deps.yt_dlp.hint or "安装 yt-dlp")
            if not deps.ffmpeg.ok:
                missing.append(deps.ffmpeg.hint or "安装 ffmpeg")
            raise VideoDownloadError(
                "；".join(missing),
                code="missing_deps",
            )
        url = extract_video_url(body.url)
        job_id = new_id()
        work_dir = self.root / job_id
        work_dir.mkdir(parents=True, exist_ok=False)
        cookies = body.cookies_from_browser if body.use_browser_cookies else None
        job = VideoDownloadJob(
            id=job_id,
            owner_user_id=owner_user_id,
            url=url,
            quality=body.quality,
            use_browser_cookies=body.use_browser_cookies,
            cookies_from_browser=cookies,
            save_to_disk=body.save_to_disk,
            save_to_library=body.save_to_library,
            folder_id=body.folder_id,
            work_dir=work_dir,
        )
        self.jobs[job_id] = job
        task = asyncio.create_task(self._execute_job(job_id), name=f"video-download-{job_id}")
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return job.to_out()

    def get_job(self, job_id: str, *, owner_user_id: str) -> VideoDownloadJob:
        job = self.jobs.get(job_id)
        if job is None or job.owner_user_id != owner_user_id:
            raise VideoDownloadError("下载任务不存在", code="not_found", status=404)
        return job

    def job_file(self, job_id: str, *, owner_user_id: str) -> tuple[Path, str]:
        job = self.get_job(job_id, owner_user_id=owner_user_id)
        if job.status != "succeeded" or not job.save_to_disk:
            raise VideoDownloadError("当前任务没有可下载文件", code="file_unavailable", status=404)
        if job.file_path is None or not job.file_path.is_file():
            raise VideoDownloadError("下载文件已清理或不存在", code="file_unavailable", status=404)
        return job.file_path, job.filename or job.file_path.name
