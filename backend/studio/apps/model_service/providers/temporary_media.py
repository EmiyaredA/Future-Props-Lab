from __future__ import annotations

import asyncio
import json
import re
from mimetypes import guess_extension
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

MAX_RESPONSE_BYTES = 4096
TEMPFILE_UPLOAD_URL = "https://tempfile.org/api/upload/local"


class TemporaryMediaError(Exception):
    pass


def _temporary_filename(path: Path, filename: str | None, file_extension: str) -> str:
    extension = file_extension.strip().lower() or path.suffix.lower()
    if extension and not extension.startswith("."):
        extension = f".{extension}"
    if not filename:
        return f"{uuid4().hex}{extension}"
    cleaned = "".join(
        character if ord(character) >= 32 and character not in "/\\" else "-"
        for character in filename.strip()
    ).strip(" .")
    if extension and cleaned.lower().endswith(extension):
        cleaned = cleaned[: -len(extension)].strip(" .")
    return f"{cleaned or 'reference'}{extension}"


def _validated_result_url(value: str, upload_url: str) -> str:
    if len(value.encode("utf-8")) > MAX_RESPONSE_BYTES:
        raise TemporaryMediaError("临时参考素材上传返回了无效响应")
    result = value.strip()
    parsed = urlsplit(result)
    expected = urlsplit(upload_url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.hostname.lower() != (expected.hostname or "").lower()
        or parsed.path in {"", "/"}
        or parsed.fragment
        or any(character.isspace() for character in result)
    ):
        raise TemporaryMediaError("临时参考素材上传返回了无效地址")
    return result


def _tempfile_download_url(body: str) -> str:
    try:
        response = json.loads(body)
        files = response["files"]
        if response["success"] is not True or not isinstance(files, list) or len(files) != 1:
            raise ValueError
        file_id = files[0]["id"]
        if not isinstance(file_id, str) or not re.fullmatch(r"[A-Za-z0-9]+", file_id):
            raise ValueError
    except (KeyError, TypeError, ValueError) as exc:
        raise TemporaryMediaError("临时参考素材上传返回了无效响应") from exc
    return f"https://tempfile.org/{file_id}/download"


async def upload_temporary_media(
    *,
    path: Path,
    mime_type: str,
    upload_url: str,
    transport: httpx.AsyncBaseTransport | None = None,
    retry_delay: float = 0.25,
    filename: str | None = None,
    file_extension: str = "",
) -> str:
    if not upload_url.strip():
        raise TemporaryMediaError("未配置参考素材临时上传服务")
    if not path.is_file():
        raise TemporaryMediaError("参考素材文件已不存在")
    extension = file_extension or path.suffix or guess_extension(mime_type) or ""
    upload_filename = _temporary_filename(path, filename, extension)
    tempfile_org = upload_url == TEMPFILE_UPLOAD_URL
    form_field = "files" if tempfile_org else "file"
    timeout = httpx.Timeout(300.0, connect=15.0, pool=30.0)
    for attempt in range(2):
        try:
            with path.open("rb") as source:
                async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
                    async with client.stream(
                        "POST",
                        upload_url,
                        files={form_field: (upload_filename, source, mime_type)},
                        data={"expiryHours": "1"} if tempfile_org else None,
                    ) as response:
                        if response.status_code == 429 or response.status_code >= 500:
                            if attempt == 0:
                                await asyncio.sleep(retry_delay)
                                continue
                            raise TemporaryMediaError("临时参考素材上传服务暂时不可用")
                        if response.is_error:
                            raise TemporaryMediaError("临时参考素材上传失败")
                        body = bytearray()
                        async for chunk in response.aiter_bytes():
                            body.extend(chunk)
                            if len(body) > MAX_RESPONSE_BYTES:
                                raise TemporaryMediaError("临时参考素材上传返回了无效响应")
                        try:
                            result = body.decode("utf-8")
                        except UnicodeDecodeError as exc:
                            raise TemporaryMediaError("临时参考素材上传返回了无效响应") from exc
                        if tempfile_org:
                            result = _tempfile_download_url(result)
                        return _validated_result_url(result, upload_url)
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            if attempt == 0:
                await asyncio.sleep(retry_delay)
                continue
            raise TemporaryMediaError("临时参考素材上传服务暂时不可用") from exc
    raise TemporaryMediaError("临时参考素材上传失败")
