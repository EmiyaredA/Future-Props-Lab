"""Bounded archive validation and staging without access to the asset library."""

import asyncio
import json
import shutil
import zipfile
import zlib
from pathlib import Path
from typing import BinaryIO

from pydantic import ValidationError

from app.runtime.zip_members import safe_zip_member

from .archive_import import validate_payload
from .errors import ThoughtError
from .schemas.workshop import ThoughtNoteIn


def extract_archive(
    path: Path | BinaryIO,
    root: Path,
    *,
    maximum_files: int,
    maximum_bytes: int,
    maximum_asset_bytes: int,
) -> tuple[dict, list[ThoughtNoteIn]]:
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > maximum_files:
                raise ThoughtError("导入文件数量超过限制", 413)
            if sum(item.file_size for item in entries) > maximum_bytes:
                raise ThoughtError("解压大小超过限制", 413)
            names = set()
            for item in entries:
                if item.flag_bits & 1:
                    raise ThoughtError("备份包含加密文件")
                if not safe_zip_member(item):
                    raise ThoughtError("备份包含不安全路径")
                if item.filename in names:
                    raise ThoughtError("归档包含重复路径")
                names.add(item.filename)
            manifest = archive.getinfo("manifest.json")
            if manifest.file_size > 32 * 1024 * 1024:
                raise ThoughtError("备份清单过大", 413)
            payload, parsed = validate_payload(json.loads(archive.read(manifest)))
            sources = []
            for asset in payload["assets"]:
                if asset["path"] == manifest.filename or asset["path"] not in names:
                    raise ThoughtError("备份缺少附件文件")
                info = archive.getinfo(asset["path"])
                if info.is_dir():
                    raise ThoughtError("备份附件路径指向目录")
                if info.file_size > maximum_asset_bytes:
                    raise ThoughtError("文件超过大小限制", 413)
                sources.append(info)
            for i, (asset, info) in enumerate(zip(payload["assets"], sources, strict=True)):
                dest = root / f"image-{i}"
                with archive.open(info) as source, dest.open("xb") as target:
                    shutil.copyfileobj(source, target)
                asset["staged_path"] = str(dest)
        return payload, parsed
    except (
        KeyError,
        TypeError,
        ValueError,
        zipfile.BadZipFile,
        NotImplementedError,
        zlib.error,
        ValidationError,
    ) as exc:
        raise ThoughtError("备份内容无效或不完整") from exc


async def stage_archive(upload, root: Path, *, maximum_bytes: int) -> Path:
    path = root / "upload.zip"
    size = 0
    with path.open("xb") as target:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > maximum_bytes:
                raise ThoughtError("备份超过大小限制", 413)
            await asyncio.to_thread(target.write, chunk)
    return path
