"""Authorized, revisioned file previews. Expensive work runs outside the read transaction."""

import asyncio
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4
from weakref import WeakKeyDictionary

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.schemas.files import FilePreviewOut

from .file_previews import (
    audio_waveform,
    media_duration,
    video_cover,
)

_capacities: WeakKeyDictionary = WeakKeyDictionary()
TEXT_LIMIT = 64 * 1024
PDF_TIMEOUT_SECONDS = 30
TEXT_EXTENSIONS = {".txt", ".md", ".json", ".csv"}


def _capacity() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    if loop not in _capacities:
        _capacities[loop] = asyncio.Semaphore(2)
    return _capacities[loop]


@dataclass(frozen=True)
class PreviewSource:
    id: str
    revision: int
    owner_user_id: str
    media_kind: str
    mime_type: str
    original_filename: str


def preview_kind(info: PreviewSource) -> str:
    if info.media_kind in {"image", "video", "audio"}:
        return info.media_kind
    if info.mime_type == "application/pdf":
        return "pdf"
    if Path(info.original_filename).suffix.lower() in TEXT_EXTENSIONS:
        return "text"
    return "unsupported"


def cache_root(settings, info: PreviewSource) -> Path:
    return settings.account_path(info.owner_user_id) / "previews" / info.id


async def pdf_worker(source: Path, action: str, *args: str) -> dict:
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "app.capabilities.media_rendering.pdf_preview_worker",
        str(source),
        action,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        async with asyncio.timeout(PDF_TIMEOUT_SECONDS):
            output, _ = await process.communicate()
        if process.returncode == 2:
            raise AssetError("PDF 页码超出范围", code="preview_page_out_of_range")
        if process.returncode:
            raise ValueError("PDF 已加密、损坏或无法读取")
        return json.loads(output) if action == "info" else {}
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


def _text_preview(source: Path) -> FilePreviewOut:
    with source.open("rb") as stream:
        content = stream.read(TEXT_LIMIT + 1)
    truncated = len(content) > TEXT_LIMIT
    content = content[:TEXT_LIMIT]
    # UTF-16 BOM is common in exported documents; otherwise prefer UTF-8, then GB18030.
    encoding = "utf-16" if content.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    try:
        text = content.decode(encoding, errors="ignore" if truncated else "strict")
    except UnicodeError:
        text = content.decode("gb18030", errors="replace")
    return FilePreviewOut(kind="text", text=text, truncated=truncated)


async def describe_preview(settings, info: PreviewSource, source: Path) -> FilePreviewOut:
    kind = preview_kind(info)
    if kind in {"unsupported", "image"}:
        return FilePreviewOut(kind=kind)
    target = cache_root(settings, info) / f"{info.revision}-preview-v1.json"
    try:
        async with _capacity():
            if target.is_file():
                try:
                    return FilePreviewOut.model_validate_json(
                        await asyncio.to_thread(target.read_text)
                    )
                except ValueError:
                    # A damaged derived record can be rebuilt from the authorized original.
                    pass
            if kind == "text":
                result = await asyncio.to_thread(_text_preview, source)
            elif kind == "pdf":
                result = FilePreviewOut(kind="pdf", **await pdf_worker(source, "info"))
            else:
                duration = await media_duration(source)
                result = FilePreviewOut(
                    kind=kind,
                    duration_seconds=duration,
                    waveform_seconds=min(duration, 60)
                    if duration is not None and kind == "audio"
                    else None,
                )
            await asyncio.to_thread(_save_metadata, target, result)
            return result
    except (ValueError, OSError, TimeoutError) as exc:
        raise AssetError("预览读取失败，文件可能损坏或已加密", code="preview_failed") from exc


def _save_metadata(target: Path, result: FilePreviewOut) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    staged = target.with_name(uuid4().hex + ".tmp")
    try:
        staged.write_text(result.model_dump_json(), encoding="utf-8")
        os.replace(staged, target)
    finally:
        staged.unlink(missing_ok=True)


async def media_thumbnail(
    settings, info: PreviewSource, source: Path, size: int, page: int
) -> Path:
    kind = preview_kind(info)
    if kind not in {"video", "audio", "pdf"}:
        raise AssetError("此文件暂不支持缩略预览", code="thumbnail_unsupported")
    if kind != "pdf" and page != 1:
        raise AssetError("只有 PDF 支持分页预览", code="preview_page_out_of_range")
    target = cache_root(settings, info) / f"{info.revision}-{size}-{page}-preview-v1.webp"
    async with _capacity():
        if target.is_file():
            return target
        target.parent.mkdir(parents=True, exist_ok=True)
        staged = target.with_name(uuid4().hex + ".tmp")
        try:
            if kind == "pdf":
                await pdf_worker(source, "render", str(staged), str(page), str(size))
            elif kind == "video":
                await video_cover(source, staged, size)
            else:
                await audio_waveform(source, staged, size)
            os.replace(staged, target)
        except (ValueError, OSError, TimeoutError) as exc:
            raise AssetError("内容预览生成失败，请重试或下载原文件", code="preview_failed") from exc
        finally:
            staged.unlink(missing_ok=True)
    return target
