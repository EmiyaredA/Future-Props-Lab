"""Fixed native video download and file naming, independent of server persistence."""

import json
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

from app.tool_navigation.video_download_douyin import fetch_douyin_media
from app.tool_navigation.video_download_errors import VideoDownloadError
from app.tool_navigation.video_download_source import normalize_host

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
    host = normalize_host(urlsplit(url).hostname or "")
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
