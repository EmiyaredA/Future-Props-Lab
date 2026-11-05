"""Download Douyin / Bilibili videos through the local yt-dlp binary."""

from __future__ import annotations

import asyncio
import shutil
import threading
from dataclasses import dataclass, field
from pathlib import Path

from app.capabilities.asset_store.library import AssetError, AssetLibrary
from app.runtime.config import Settings, get_settings
from app.runtime.db import SessionLocal
from app.tool_navigation.video_download_contracts import BinaryStatus as BinaryStatus
from app.tool_navigation.video_download_contracts import (
    VideoDownloadAssetOut as VideoDownloadAssetOut,
)
from app.tool_navigation.video_download_contracts import (
    VideoDownloadDepsOut as VideoDownloadDepsOut,
)
from app.tool_navigation.video_download_contracts import (
    VideoDownloadJobCreate as VideoDownloadJobCreate,
)
from app.tool_navigation.video_download_contracts import VideoDownloadJobOut as VideoDownloadJobOut
from app.tool_navigation.video_download_dependencies import probe_deps as probe_deps
from app.tool_navigation.video_download_errors import VideoDownloadError
from app.tool_navigation.video_download_execution import (
    MIME_BY_EXTENSION,
    VIDEO_EXTENSIONS,
    _find_media,
    _read_title,
    _run_yt_dlp,
    _safe_filename,
)
from app.tool_navigation.video_download_execution import (
    _network_hint as _network_hint,
)
from app.tool_navigation.video_download_source import extract_video_url
from app.tool_navigation.video_download_source import validate_video_url as validate_video_url
from studio.runtime.ids import new_id
from studio.runtime.time import iso_utc, utc_now

BROWSER_CHOICES = ("chrome", "chromium", "edge", "safari", "brave", "firefox")
QUALITY_CHOICES = ("best", "1080", "720", "480")
_JOBS_LOCK = threading.Lock()
_JOBS: dict[str, VideoDownloadJob] = {}


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


def _jobs_root(settings: Settings | None = None) -> Path:
    root = (settings or get_settings()).runtime_path / "tool-navigation" / "video-download"
    root.mkdir(parents=True, exist_ok=True)
    return root


async def _ingest_library(
    job: VideoDownloadJob,
    media: Path,
) -> VideoDownloadAssetOut:
    settings = get_settings()
    async with SessionLocal() as session:
        library = AssetLibrary(session, settings)
        try:
            row, _staged = await library.stage_local_copy(
                media,
                owner_user_id=job.owner_user_id,
                filename=media.name,
                content_type=MIME_BY_EXTENSION.get(media.suffix.lower(), "video/mp4"),
                folder_id=job.folder_id,
                allowed_extensions=VIDEO_EXTENSIONS,
            )
            await session.commit()
            await session.refresh(row)
        except AssetError as exc:
            raise VideoDownloadError(str(exc), code=exc.code, status=exc.status) from exc
        return VideoDownloadAssetOut(
            id=row.id,
            display_name=row.display_name,
            original_filename=row.original_filename,
            mime_type=row.mime_type,
            byte_size=row.byte_size,
        )


async def _execute_job(job_id: str) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if job is None:
        return
    job.status = "running"
    job.touch()
    try:
        await asyncio.to_thread(
            _run_yt_dlp,
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
            job.asset = await _ingest_library(job, media)
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
    body: VideoDownloadJobCreate,
    *,
    owner_user_id: str,
) -> VideoDownloadJobOut:
    deps = probe_deps()
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
    work_dir = _jobs_root() / job_id
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
    with _JOBS_LOCK:
        _JOBS[job_id] = job
    asyncio.get_running_loop().create_task(_execute_job(job_id), name=f"video-download-{job_id}")
    return job.to_out()


def get_job(job_id: str, *, owner_user_id: str) -> VideoDownloadJob:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if job is None or job.owner_user_id != owner_user_id:
        raise VideoDownloadError("下载任务不存在", code="not_found", status=404)
    return job


def job_file(job_id: str, *, owner_user_id: str) -> tuple[Path, str]:
    job = get_job(job_id, owner_user_id=owner_user_id)
    if job.status != "succeeded" or not job.save_to_disk:
        raise VideoDownloadError("当前任务没有可下载文件", code="file_unavailable", status=404)
    if job.file_path is None or not job.file_path.is_file():
        raise VideoDownloadError("下载文件已清理或不存在", code="file_unavailable", status=404)
    return job.file_path, job.filename or job.file_path.name


def reset_jobs_for_tests() -> None:
    with _JOBS_LOCK:
        jobs = list(_JOBS.values())
        _JOBS.clear()
    for job in jobs:
        shutil.rmtree(job.work_dir, ignore_errors=True)
