"""Fixed-source downloads with bounded files, resumption and atomic verification."""

import asyncio
import hashlib
import os
from pathlib import Path

import httpx


async def fetch_file(client, item, target: Path, progress=None):
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    if target.is_file() and target.stat().st_size == item["size"]:
        if await digest(target) == item["sha256"]:
            return
        target.unlink()
    offset = part.stat().st_size if part.exists() else 0
    if offset > item["size"]:
        part.unlink()
        offset = 0
    if offset < item["size"]:
        headers = {"Range": f"bytes={offset}-"} if offset else {}
        async with client.stream("GET", item["url"], headers=headers) as response:
            response.raise_for_status()
            if response.url.scheme != "https":
                raise ValueError("模型下载必须使用 HTTPS")
            if offset and response.status_code == 206:
                if not response.headers.get("content-range", "").startswith(f"bytes {offset}-"):
                    raise ValueError("下载续传响应无效")
            else:
                offset = 0
            with part.open("ab" if offset else "wb") as output:
                async for chunk in response.aiter_bytes(1024 * 1024):
                    if offset + len(chunk) > item["size"]:
                        raise ValueError("下载超过清单大小")
                    output.write(chunk)
                    offset += len(chunk)
                    if progress:
                        await progress(offset)
    if offset != item["size"] or await digest(part) != item["sha256"]:
        part.unlink(missing_ok=True)
        raise ValueError("下载文件 SHA256 校验失败，请重试")
    os.replace(part, target)


async def digest(path):
    def calculate():
        with path.open("rb") as source:
            return hashlib.file_digest(source, "sha256").hexdigest()

    return await asyncio.to_thread(calculate)


def client():
    return httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(120, connect=30))
