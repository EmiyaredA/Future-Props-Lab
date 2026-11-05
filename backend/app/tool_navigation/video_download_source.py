"""Normalize allowlisted Douyin and Bilibili URLs before a download is accepted."""

import re
from urllib.parse import parse_qs, urlsplit, urlunsplit

from app.tool_navigation.video_download_errors import VideoDownloadError

_ALLOWED_HOST_SUFFIXES = (
    "bilibili.com",
    "b23.tv",
    "douyin.com",
    "iesdouyin.com",
)
_HOST_LABEL = re.compile(r"^[a-z0-9.-]+$")
_URL_IN_TEXT = re.compile(r"https?://[^\s<>\"'`，。；、！？]+", re.IGNORECASE)
_DOUYIN_VIDEO_PATH = re.compile(r"/video/(\d+)", re.IGNORECASE)


def normalize_host(host: str) -> str:
    return host.strip().lower().rstrip(".")


def _host_allowed(host: str) -> bool:
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in _ALLOWED_HOST_SUFFIXES)


def _strip_url_noise(raw: str) -> str:
    return raw.rstrip(").,]，。；、！？》」』\"'")


def _canonical_douyin_url(url: str) -> str:
    """Map jingxuan/share pages to /video/{id} so yt-dlp DouyinIE can match."""
    parsed = urlsplit(url)
    host = normalize_host(parsed.hostname or "")
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
    host = normalize_host(parsed.hostname or "")
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
