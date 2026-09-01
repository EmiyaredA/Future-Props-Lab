from __future__ import annotations

import asyncio
import base64
import ipaddress
import socket
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx

MAX_REDIRECTS = 4


class GenerationMaterializationError(Exception):
    """Safe, user-displayable error raised while persisting provider output."""


def generated_type(head: bytes, content_type: str) -> tuple[str, str, str] | None:
    normalized_type = content_type.split(";", 1)[0].strip().lower()
    accepted_types: set[str]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        detected = ("image", "image/png", ".png")
        accepted_types = {"image/png"}
    elif head.startswith(b"\xff\xd8\xff"):
        detected = ("image", "image/jpeg", ".jpg")
        accepted_types = {"image/jpeg"}
    elif head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        detected = ("image", "image/webp", ".webp")
        accepted_types = {"image/webp"}
    elif head.startswith(b"RIFF") and head[8:12] == b"WAVE":
        detected = ("audio", "audio/wav", ".wav")
        accepted_types = {"audio/wav", "audio/x-wav", "audio/wave"}
    elif head.startswith((b"GIF87a", b"GIF89a")):
        detected = ("image", "image/gif", ".gif")
        accepted_types = {"image/gif"}
    elif head.startswith(b"ID3") or (
        len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0
    ):
        detected = ("audio", "audio/mpeg", ".mp3")
        accepted_types = {"audio/mpeg", "audio/mp3"}
    elif b"ftyp" in head[4:16]:
        if normalized_type in {"audio/mp4", "audio/x-m4a", "audio/m4a"}:
            detected = ("audio", "audio/mp4", ".m4a")
            accepted_types = {"audio/mp4", "audio/x-m4a", "audio/m4a"}
        else:
            mime = "video/quicktime" if normalized_type == "video/quicktime" else "video/mp4"
            detected = ("video", mime, ".mov" if mime == "video/quicktime" else ".mp4")
            accepted_types = {mime}
    elif head.startswith(b"\x1aE\xdf\xa3"):
        detected = ("video", "video/webm", ".webm")
        accepted_types = {"video/webm"}
    elif head.startswith(b"OggS"):
        detected = ("audio", "audio/ogg", ".ogg")
        accepted_types = {"audio/ogg", "application/ogg"}
    else:
        return None
    return detected if normalized_type in accepted_types else None


async def assert_public_https(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise GenerationMaterializationError("生成结果必须使用无凭证的 HTTPS 公网地址")

    def resolve() -> list[str]:
        return list(
            {
                item[4][0]
                for item in socket.getaddrinfo(
                    parsed.hostname,
                    parsed.port or 443,
                    type=socket.SOCK_STREAM,
                )
            }
        )

    try:
        addresses = await asyncio.to_thread(resolve)
    except OSError as exc:
        raise GenerationMaterializationError("无法解析生成结果地址") from exc
    if not addresses:
        raise GenerationMaterializationError("生成结果地址没有可用 IP")
    if any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise GenerationMaterializationError("生成结果地址指向非公网网络")


async def download_generated_media(
    *,
    url: str,
    target: Path,
    max_bytes: int,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[int, str, str, str]:
    current_url = url
    content_type = ""
    size = 0
    head = bytearray()
    timeout = httpx.Timeout(120.0, connect=15.0)
    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=False,
            transport=transport,
        ) as client:
            for _ in range(MAX_REDIRECTS + 1):
                await assert_public_https(current_url)
                async with client.stream("GET", current_url) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise GenerationMaterializationError("生成结果重定向缺少地址")
                        current_url = urljoin(current_url, location)
                        continue
                    if response.is_error:
                        raise GenerationMaterializationError(
                            f"生成结果下载失败（HTTP {response.status_code}）"
                        )
                    declared_size = response.headers.get("content-length")
                    if (
                        declared_size
                        and declared_size.isdecimal()
                        and int(declared_size) > max_bytes
                    ):
                        raise GenerationMaterializationError("生成结果超过文件大小上限")
                    with target.open("xb") as output:
                        async for chunk in response.aiter_bytes(1024 * 1024):
                            size += len(chunk)
                            if size > max_bytes:
                                raise GenerationMaterializationError("生成结果超过文件大小上限")
                            if len(head) < 512:
                                head.extend(chunk[: 512 - len(head)])
                            output.write(chunk)
                    content_type = response.headers.get("content-type", "")
                    break
            else:
                raise GenerationMaterializationError("生成结果重定向次数过多")
    except GenerationMaterializationError:
        raise
    except httpx.HTTPError as exc:
        raise GenerationMaterializationError("生成结果下载网络错误") from exc

    detected = generated_type(bytes(head), content_type)
    if size == 0 or detected is None:
        raise GenerationMaterializationError("生成结果不是受支持的图片、视频或音频")
    return size, *detected


async def read_data_uri(*, path: Path, mime_type: str, max_bytes: int | None = None) -> str:
    if not path.is_file():
        raise ValueError("参考素材文件已不存在")
    if max_bytes is not None and path.stat().st_size > max_bytes:
        raise ValueError("参考图片超过 SenseAudio 的 30 MB 限制")
    data = await asyncio.to_thread(path.read_bytes)
    return f"data:{mime_type};base64,{base64.b64encode(data).decode('ascii')}"
