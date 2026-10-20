"""Download Douyin / Bilibili videos through the local yt-dlp binary."""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, model_validator

from app.capabilities.asset_store.library import AssetError, AssetLibrary
from app.runtime.config import Settings, get_settings
from app.runtime.db import SessionLocal
from app.runtime.ids import new_id
from app.runtime.time import iso_utc, utc_now

BROWSER_CHOICES = ("chrome", "chromium", "edge", "safari", "brave", "firefox")
QUALITY_CHOICES = ("best", "1080", "720", "480")
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".m4v"}
MIME_BY_EXTENSION = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
}
QUALITY_FORMAT = {
    "best": "bv*+ba/b",
    "1080": "bv*[height<=1080]+ba/b[height<=1080]/best",
    "720": "bv*[height<=720]+ba/b[height<=720]/best",
    "480": "bv*[height<=480]+ba/b[height<=480]/best",
}
_ALLOWED_HOST_SUFFIXES = (
    "bilibili.com",
    "b23.tv",
    "douyin.com",
    "iesdouyin.com",
)
_HOST_LABEL = re.compile(r"^[a-z0-9.-]+$")
_JOBS_LOCK = threading.Lock()
_JOBS: dict[str, "VideoDownloadJob"] = {}


class VideoDownloadError(ValueError):
    def __init__(self, message: str, *, code: str = "video_download_error", status: int = 422):
        super().__init__(message)
        self.code = code
        self.status = status


class BinaryStatus(BaseModel):
    name: str
    ok: bool
    path: str | None = None
    version: str | None = None
    hint: str | None = None


class VideoDownloadDepsOut(BaseModel):
    ready: bool
    yt_dlp: BinaryStatus
    ffmpeg: BinaryStatus


class VideoDownloadJobCreate(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    quality: str = Field(default="best", pattern=r"^(best|1080|720|480)$")
    use_browser_cookies: bool = False
    cookies_from_browser: str = Field(default="chrome", pattern=r"^(chrome|chromium|edge|safari|brave|firefox)$")
    save_to_disk: bool = True
    save_to_library: bool = True
    folder_id: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def require_destination(self) -> VideoDownloadJobCreate:
        if not self.save_to_disk and not self.save_to_library:
            raise ValueError("至少选择一种保存方式")
        if self.folder_id is not None and not self.folder_id.strip():
            self.folder_id = None
        return self


class VideoDownloadAssetOut(BaseModel):
    id: str
    display_name: str
    original_filename: str
    mime_type: str
    byte_size: int


class VideoDownloadJobOut(BaseModel):
    id: str
    status: str
    url: str
    quality: str
    use_browser_cookies: bool
    cookies_from_browser: str | None
    save_to_disk: bool
    save_to_library: bool
    title: str | None = None
    filename: str | None = None
    byte_size: int | None = None
    error: str | None = None
    asset: VideoDownloadAssetOut | None = None
    created_at: str
    updated_at: str


@dataclass
class VideoDownloadJob:
    id: str
    workspace_id: str
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


def _normalize_host(host: str) -> str:
    return host.strip().lower().rstrip(".")


def validate_video_url(url: str) -> str:
    raw = url.strip()
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise VideoDownloadError("请提供有效的 http(s) 视频链接", code="invalid_url")
    host = _normalize_host(parsed.hostname or "")
    if not host or not _HOST_LABEL.match(host):
        raise VideoDownloadError("视频链接主机无效", code="invalid_url")
    if not any(host == suffix or host.endswith(f".{suffix}") for suffix in _ALLOWED_HOST_SUFFIXES):
        raise VideoDownloadError(
            "仅支持抖音或哔哩哔哩链接",
            code="unsupported_host",
        )
    return raw


def _probe_binary(name: str, *, version_flag: str = "--version") -> BinaryStatus:
    path = shutil.which(name)
    if not path:
        hint = (
            'macOS: brew install yt-dlp ffmpeg'
            if name == "yt-dlp"
            else "macOS: brew install ffmpeg"
        )
        return BinaryStatus(name=name, ok=False, hint=hint)
    try:
        result = subprocess.run(
            [path, version_flag],
            capture_output=True,
            text=True,
            check=False,
            timeout=8,
        )
    except (OSError, subprocess.TimeoutExpired):
        return BinaryStatus(
            name=name,
            ok=False,
            path=path,
            hint=f"无法执行 {name}，请检查安装",
        )
    version_line = (result.stdout or result.stderr or "").strip().splitlines()
    version = version_line[0].strip() if version_line else None
    ok = result.returncode == 0
    return BinaryStatus(
        name=name,
        ok=ok,
        path=path,
        version=version,
        hint=None if ok else f"{name} 返回异常退出码",
    )


def probe_deps() -> VideoDownloadDepsOut:
    yt_dlp = _probe_binary("yt-dlp")
    ffmpeg = _probe_binary("ffmpeg", version_flag="-version")
    return VideoDownloadDepsOut(ready=yt_dlp.ok and ffmpeg.ok, yt_dlp=yt_dlp, ffmpeg=ffmpeg)


def _jobs_root(settings: Settings | None = None) -> Path:
    root = (settings or get_settings()).runtime_path / "tool-navigation" / "video-download"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_filename(name: str, extension: str) -> str:
    stem = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", name.strip())[:80].strip("._") or "video"
    ext = extension if extension.startswith(".") else f".{extension}"
    return f"{stem}{ext}"


def _find_media(work_dir: Path) -> Path:
    candidates = [
        path
        for path in work_dir.iterdir()
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS and path.stat().st_size > 0
    ]
    if not candidates:
        raise VideoDownloadError("下载完成但未找到视频文件", code="missing_output")
    candidates.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    return candidates[0]


def _read_title(work_dir: Path, fallback: str) -> str:
    for path in work_dir.glob("*.info.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        title = str(payload.get("title") or "").strip()
        if title:
            return title
    return fallback


def _network_hint(stderr: str) -> str:
    detail = (stderr or "").strip()
    lower = detail.lower()
    if any(
        token in lower
        for token in (
            "sign in",
            "login required",
            "authentication required",
            "cookies are needed",
            "confirm you're not a bot",
            "confirm you’re not a bot",
        )
    ):
        return "此视频可能需要登录 Cookie；请开启「从浏览器读取 Cookie」并确认系统授权后重试。"
    if "could not copy cookies" in lower or "failed to decrypt" in lower:
        return "无法读取浏览器 Cookie；请在系统弹出的钥匙串/浏览器提示中允许访问后重试。"
    if re.search(r"\b403\b", lower) or "forbidden" in lower:
        return "来源拒绝访问（403）。可更新 yt-dlp 后重试，或开启浏览器 Cookie。"
    if "429" in lower or "too many requests" in lower:
        return "来源限流，请稍后再试。"
    clipped = detail[-800:] if len(detail) > 800 else detail
    return clipped or "yt-dlp 下载失败"


def _run_yt_dlp(
    *,
    url: str,
    quality: str,
    work_dir: Path,
    cookies_from_browser: str | None,
) -> None:
    yt_dlp = shutil.which("yt-dlp")
    if not yt_dlp:
        raise VideoDownloadError(
            "未找到 yt-dlp，请先安装：brew install yt-dlp ffmpeg",
            code="missing_yt_dlp",
        )
    if not shutil.which("ffmpeg"):
        raise VideoDownloadError(
            "未找到 ffmpeg，请先安装：brew install ffmpeg",
            code="missing_ffmpeg",
        )
    output = str((work_dir / "video.%(ext)s").resolve()).replace("%", "%%")
    command = [
        yt_dlp,
        "--no-playlist",
        "--no-simulate",
        "--newline",
        "--write-info-json",
        "-f",
        QUALITY_FORMAT[quality],
        "--merge-output-format",
        "mp4",
        "-o",
        output,
    ]
    if cookies_from_browser:
        command.extend(["--cookies-from-browser", cookies_from_browser])
    command.append(url)
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
        cwd=str(work_dir),
        timeout=60 * 30,
    )
    if result.returncode != 0:
        raise VideoDownloadError(
            _network_hint(result.stderr or result.stdout),
            code="download_failed",
        )


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
                workspace_id=job.workspace_id,
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
    workspace_id: str,
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
    url = validate_video_url(body.url)
    job_id = new_id()
    work_dir = _jobs_root() / job_id
    work_dir.mkdir(parents=True, exist_ok=False)
    cookies = body.cookies_from_browser if body.use_browser_cookies else None
    job = VideoDownloadJob(
        id=job_id,
        workspace_id=workspace_id,
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


def get_job(job_id: str, *, workspace_id: str) -> VideoDownloadJob:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if job is None or job.workspace_id != workspace_id:
        raise VideoDownloadError("下载任务不存在", code="not_found", status=404)
    return job


def job_file(job_id: str, *, workspace_id: str) -> tuple[Path, str]:
    job = get_job(job_id, workspace_id=workspace_id)
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
