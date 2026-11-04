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
from urllib.parse import parse_qs, urlsplit, urlunsplit

from app.capabilities.asset_store.library import AssetError, AssetLibrary
from app.runtime.config import Settings, get_settings
from app.runtime.db import SessionLocal
from app.runtime.ids import new_id
from app.runtime.time import iso_utc, utc_now
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
from app.tool_navigation.video_download_douyin import fetch_douyin_media
from app.tool_navigation.video_download_errors import VideoDownloadError

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
_URL_IN_TEXT = re.compile(r"https?://[^\s<>\"'`，。；、！？]+", re.IGNORECASE)
_DOUYIN_VIDEO_PATH = re.compile(r"/video/(\d+)", re.IGNORECASE)
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


def _normalize_host(host: str) -> str:
    return host.strip().lower().rstrip(".")


def _host_allowed(host: str) -> bool:
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in _ALLOWED_HOST_SUFFIXES)


def _strip_url_noise(raw: str) -> str:
    return raw.rstrip(").,]，。；、！？》」』\"'")


def _canonical_douyin_url(url: str) -> str:
    """Map jingxuan/share pages to /video/{id} so yt-dlp DouyinIE can match."""
    parsed = urlsplit(url)
    host = _normalize_host(parsed.hostname or "")
    if "douyin.com" not in host and "iesdouyin.com" not in host:
        return url
    path_match = _DOUYIN_VIDEO_PATH.search(parsed.path or "")
    if path_match:
        return f"https://www.douyin.com/video/{path_match.group(1)}"
    query = parse_qs(parsed.query)
    modal_id = (query.get("modal_id") or [None])[0]
    if modal_id and str(modal_id).isdigit():
        return f"https://www.douyin.com/video/{modal_id}"
    return url


def extract_video_url(value: str) -> str:
    """Accept a bare URL or share-text paste that embeds one allowed URL."""
    text = value.strip()
    if not text:
        raise VideoDownloadError("请提供有效的 http(s) 视频链接", code="invalid_url")
    candidates: list[str] = []
    for match in _URL_IN_TEXT.finditer(text):
        candidates.append(_strip_url_noise(match.group(0)))
    if not candidates and text.lower().startswith(("http://", "https://")):
        candidates.append(_strip_url_noise(text.split()[0]))
    if not candidates:
        raise VideoDownloadError(
            "未找到可用链接。请粘贴抖音/B站分享链接，或点「如何获取链接」查看步骤。",
            code="invalid_url",
        )
    last_error: VideoDownloadError | None = None
    for candidate in candidates:
        try:
            return validate_video_url(candidate)
        except VideoDownloadError as exc:
            last_error = exc
    assert last_error is not None
    raise last_error


def validate_video_url(url: str) -> str:
    raw = _strip_url_noise(url.strip())
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise VideoDownloadError("请提供有效的 http(s) 视频链接", code="invalid_url")
    host = _normalize_host(parsed.hostname or "")
    if not host or not _HOST_LABEL.match(host):
        raise VideoDownloadError("视频链接主机无效", code="invalid_url")
    if not _host_allowed(host):
        raise VideoDownloadError(
            "仅支持抖音或哔哩哔哩链接",
            code="unsupported_host",
        )
    # Drop fragments; keep query only when needed for short-link hosts.
    cleaned = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    return _canonical_douyin_url(cleaned)


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
    if "fresh cookies" in lower or "cookies (not necessarily logged in) are needed" in lower:
        return (
            "此视频可能需要登录后才能下载。请开启「从本机浏览器读取 Cookie」，"
            "在浏览器打开并播放该视频后再试。"
        )
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
    if "tunnel connection failed" in lower or "unable to connect to proxy" in lower:
        return "本机代理拒绝了 yt-dlp 的外网请求。请检查系统/终端代理设置后重试。"
    if re.search(r"\b403\b", lower) or "forbidden" in lower:
        return "来源拒绝访问（403）。可开启浏览器 Cookie，先在浏览器打开并播放该视频后再试。"
    if "429" in lower or "too many requests" in lower:
        return "来源限流，请稍后再试。"
    clipped = detail[-800:] if len(detail) > 800 else detail
    return clipped or "yt-dlp 下载失败"


def _is_douyin_url(url: str) -> bool:
    host = _normalize_host(urlsplit(url).hostname or "")
    return "douyin.com" in host or "iesdouyin.com" in host


def _export_browser_cookie_header(browser: str, *, work_dir: Path) -> str | None:
    """Best-effort Netscape cookie dump for Douyin detail requests."""
    yt_dlp = shutil.which("yt-dlp")
    if not yt_dlp:
        return None
    cookie_file = work_dir / "browser-cookies.txt"
    # Visiting the host forces yt-dlp to materialize cookies from the browser jar.
    result = subprocess.run(
        [
            yt_dlp,
            "--skip-download",
            "--no-playlist",
            "--cookies-from-browser",
            browser,
            "--cookies",
            str(cookie_file),
            "https://www.douyin.com/",
        ],
        capture_output=True,
        text=True,
        check=False,
        cwd=str(work_dir),
        timeout=60,
    )
    if result.returncode != 0 or not cookie_file.is_file():
        return None
    pairs: list[str] = []
    for line in cookie_file.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        domain, _flag, _path, _secure, _expires, name, value = parts[:7]
        host = domain.lstrip(".").lower()
        if "douyin.com" not in host and "iesdouyin.com" not in host:
            continue
        if name:
            pairs.append(f"{name}={value}")
    return "; ".join(pairs) if pairs else None


def _run_yt_dlp_command(
    command: list[str],
    *,
    work_dir: Path,
) -> None:
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


def _run_douyin_download(
    *,
    url: str,
    quality: str,
    work_dir: Path,
    cookies_from_browser: str | None,
    yt_dlp: str,
) -> None:
    cookie_header = None
    if cookies_from_browser:
        cookie_header = _export_browser_cookie_header(cookies_from_browser, work_dir=work_dir)
    media = fetch_douyin_media(url, quality=quality, cookie_header=cookie_header)
    info_path = work_dir / "video.info.json"
    info_path.write_text(
        json.dumps(
            {
                "id": media.video_id,
                "title": media.title,
                "webpage_url": media.webpage_url,
                "width": media.width,
                "height": media.height,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    # Escape % only in the directory path; keep yt-dlp's %(ext)s template intact.
    output = f"{str(work_dir.resolve()).replace('%', '%%')}/video.%(ext)s"
    command = [
        yt_dlp,
        "--no-playlist",
        "--no-simulate",
        "--newline",
        "-f",
        "b",
        "--merge-output-format",
        "mp4",
        "--add-header",
        "Referer:https://www.douyin.com/",
        "--add-header",
        f"User-Agent:{_DOUYIN_DOWNLOAD_UA}",
        "-o",
        output,
        media.media_url,
    ]
    _run_yt_dlp_command(command, work_dir=work_dir)


_DOUYIN_DOWNLOAD_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


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
    if _is_douyin_url(url):
        _run_douyin_download(
            url=url,
            quality=quality,
            work_dir=work_dir,
            cookies_from_browser=cookies_from_browser,
            yt_dlp=yt_dlp,
        )
        return
    output = f"{str(work_dir.resolve()).replace('%', '%%')}/video.%(ext)s"
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
    _run_yt_dlp_command(command, work_dir=work_dir)


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
