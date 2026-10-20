"""Resolve Douyin play URLs via the signed web aweme/detail API.

Stable yt-dlp releases still hit Argus 403 on Douyin's detail endpoint. This
module applies the publicly documented ``uifid`` + ``x-secsdk-web-signature``
checksum (see yt-dlp#9667 / PR #17826) so ordinary videos download without
browser cookies. Cookie injection remains available for login-gated clips.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, NoReturn
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx

from app.tool_navigation.video_download_errors import VideoDownloadError

_DOUYIN_HOST = "https://www.douyin.com/"
_DETAIL_API = "https://www.douyin.com/aweme/v1/web/aweme/detail/"
_TTWID_REGISTER = "https://www.douyin.com/ttwid/register"
_SEC_SALT = "A96D855A08C0A9707F8BEF0D9A527E4E"
_AID = 6383
_VIDEO_ID = re.compile(r"/video/(\d+)", re.IGNORECASE)
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
_QUALITY_MAX_SHORT_EDGE = {
    "best": None,
    "1080": 1080,
    "720": 720,
    "480": 480,
}


def _fail(message: str, *, code: str) -> NoReturn:
    raise VideoDownloadError(message, code=code)


@dataclass(frozen=True)
class DouyinMedia:
    video_id: str
    title: str
    media_url: str
    width: int | None
    height: int | None
    webpage_url: str


def _short_edge(width: int | None, height: int | None) -> int:
    dims = [value for value in (width, height) if isinstance(value, int) and value > 0]
    return min(dims) if dims else 0


def _first_url(payload: dict[str, Any] | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    for item in payload.get("url_list") or []:
        text = str(item or "").strip()
        if text.startswith("http"):
            return text
    return None


def _candidate_streams(video: dict[str, Any]) -> list[tuple[int, int | None, int | None, str]]:
    """Return (short_edge, width, height, url) candidates, highest quality first."""
    rows: list[tuple[int, int | None, int | None, str]] = []
    for bit in video.get("bit_rate") or []:
        if not isinstance(bit, dict):
            continue
        play = bit.get("play_addr")
        if not isinstance(play, dict):
            continue
        url = _first_url(play)
        if not url:
            continue
        width = play.get("width") if isinstance(play.get("width"), int) else None
        height = play.get("height") if isinstance(play.get("height"), int) else None
        rows.append((_short_edge(width, height), width, height, url))
    for key in ("play_addr", "play_addr_h264", "play_addr_265", "download_addr"):
        play = video.get(key)
        if not isinstance(play, dict):
            continue
        url = _first_url(play)
        if not url:
            continue
        width = play.get("width") if isinstance(play.get("width"), int) else None
        height = play.get("height") if isinstance(play.get("height"), int) else None
        rows.append((_short_edge(width, height), width, height, url))
    rows.sort(key=lambda item: item[0], reverse=True)
    deduped: list[tuple[int, int | None, int | None, str]] = []
    seen: set[str] = set()
    for row in rows:
        if row[3] in seen:
            continue
        seen.add(row[3])
        deduped.append(row)
    return deduped


def pick_stream(video: dict[str, Any], *, quality: str) -> tuple[str, int | None, int | None]:
    streams = _candidate_streams(video)
    if not streams:
        _fail("抖音未返回可下载的视频地址", code="douyin_no_media")
    cap = _QUALITY_MAX_SHORT_EDGE.get(quality)
    if cap is not None:
        capped = [row for row in streams if row[0] <= cap or row[0] == 0]
        if capped:
            streams = capped
        else:
            # Nothing under the cap — take the lowest available instead of ignoring the limit.
            streams = [min(streams, key=lambda item: item[0] or 10**9)]
    _short, width, height, url = streams[0]
    return url, width, height


def sign_detail_query(aweme_id: str, *, uifid: str, timestamp: str | None = None) -> dict[str, str]:
    stamp = timestamp or str(int(time.time()))
    query = {"aweme_id": aweme_id, "uifid": uifid, "timestamp": stamp}
    encoded = urlencode(query)
    signature = hashlib.md5(f"{uifid}_{stamp}_{_SEC_SALT}_{encoded}".encode()).hexdigest()
    return {**query, "x-secsdk-web-signature": signature}


def _apply_cookie_header(client: httpx.Client, cookie_header: str | None) -> None:
    if not cookie_header:
        return
    for part in cookie_header.split(";"):
        item = part.strip()
        if not item or "=" not in item:
            continue
        name, value = item.split("=", 1)
        name = name.strip()
        value = value.strip()
        if name:
            client.cookies.set(name, value, domain=".douyin.com")


def _ensure_session_cookies(client: httpx.Client) -> str:
    if not client.cookies.get("ttwid"):
        response = client.post(
            _TTWID_REGISTER,
            content=json.dumps({"aid": _AID, "service": "www.douyin.com"}),
            headers={"content-type": "application/json"},
        )
        response.raise_for_status()
    if not client.cookies.get("passport_csrf_token"):
        csrf = uuid.uuid4().hex
        client.cookies.set("passport_csrf_token", csrf, domain=".douyin.com")
        client.cookies.set("passport_csrf_token_default", csrf, domain=".douyin.com")
    uifid = (
        client.cookies.get("UIFID")
        or client.cookies.get("UIFID_TEMP")
        or client.cookies.get("uifid")
        or client.cookies.get("uifid_temp")
    )
    if uifid:
        return uifid
    home = client.get(_DOUYIN_HOST)
    home.raise_for_status()
    uifid = (
        client.cookies.get("UIFID")
        or client.cookies.get("UIFID_TEMP")
        or home.headers.get("x-tt-trace-host")
    )
    if not uifid:
        _fail(
            "无法建立抖音下载会话（缺少 UIFID）。请稍后重试，或开启浏览器 Cookie。",
            code="douyin_session",
        )
    return uifid


def resolve_aweme_id(url: str, *, client: httpx.Client | None = None) -> str:
    parsed = urlsplit(url)
    match = _VIDEO_ID.search(parsed.path or "")
    if match:
        return match.group(1)
    query = parse_qs(parsed.query)
    modal_id = (query.get("modal_id") or [None])[0]
    if modal_id and str(modal_id).isdigit():
        return str(modal_id)

    owns_client = client is None
    http = client or httpx.Client(
        follow_redirects=True,
        timeout=30.0,
        headers={"User-Agent": _USER_AGENT, "Referer": _DOUYIN_HOST},
    )
    try:
        response = http.get(url)
        response.raise_for_status()
        final = str(response.url)
        match = _VIDEO_ID.search(urlsplit(final).path or "")
        if match:
            return match.group(1)
        modal = (parse_qs(urlsplit(final).query).get("modal_id") or [None])[0]
        if modal and str(modal).isdigit():
            return str(modal)
        text_match = _VIDEO_ID.search(response.text or "")
        if text_match:
            return text_match.group(1)
    except httpx.HTTPError as exc:
        _fail(f"无法解析抖音短链：{exc.__class__.__name__}", code="douyin_resolve")
    finally:
        if owns_client:
            http.close()
    _fail("无法从链接解析抖音视频 ID", code="douyin_resolve")


def fetch_douyin_media(
    url: str,
    *,
    quality: str,
    cookie_header: str | None = None,
) -> DouyinMedia:
    if quality not in _QUALITY_MAX_SHORT_EDGE:
        _fail("不支持的清晰度", code="invalid_quality")

    with httpx.Client(
        follow_redirects=True,
        timeout=45.0,
        headers={
            "User-Agent": _USER_AGENT,
            "Referer": _DOUYIN_HOST,
        },
    ) as client:
        _apply_cookie_header(client, cookie_header)
        video_id = resolve_aweme_id(url, client=client)
        try:
            uifid = _ensure_session_cookies(client)
            query = sign_detail_query(video_id, uifid=uifid)
            detail = client.get(_DETAIL_API, params=query)
            detail.raise_for_status()
            payload = detail.json()
        except httpx.HTTPError:
            _fail(
                "抖音详情接口请求失败，请稍后重试或开启浏览器 Cookie。",
                code="douyin_detail",
            )
        except ValueError:
            _fail(
                "抖音详情接口返回了无法解析的内容",
                code="douyin_detail",
            )

        aweme = payload.get("aweme_detail") if isinstance(payload, dict) else None
        if not isinstance(aweme, dict):
            _fail(
                "抖音未返回视频详情（可能需登录或暂时风控）。可开启浏览器 Cookie 后重试。",
                code="douyin_detail",
            )
        video = aweme.get("video")
        if not isinstance(video, dict):
            _fail("抖音详情缺少视频流信息", code="douyin_no_media")
        media_url, width, height = pick_stream(video, quality=quality)
        title = str(aweme.get("desc") or "").strip() or f"douyin-{video_id}"
        return DouyinMedia(
            video_id=video_id,
            title=title,
            media_url=media_url,
            width=width,
            height=height,
            webpage_url=f"https://www.douyin.com/video/{video_id}",
        )
