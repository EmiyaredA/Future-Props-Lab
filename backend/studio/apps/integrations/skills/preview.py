from __future__ import annotations

from pathlib import Path, PurePosixPath

from studio.apps.integrations.clients.skill_archive import SKILL_MD_MAX_BYTES
from studio.contracts.integrations.catalog import SkillFileListOut, SkillFileOut, SkillFileTextOut
from studio.contracts.integrations.errors import (
    IntegrationNotFoundError,
    IntegrationValidationError,
)

IMAGE_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
IMAGE_MAX_BYTES = 8 * 1024 * 1024


def list_skill_files(root: Path, version: str) -> SkillFileListOut:
    files = [
        SkillFileOut(path=relative, size=path.stat().st_size, kind=_kind(path))
        for relative, path in _iter_files(root)
    ]
    return SkillFileListOut(version=version, files=files)


def read_skill_text(root: Path, version: str, relative: str) -> SkillFileTextOut:
    stored, path = resolve_skill_file(root, relative)
    if _kind(path) != "text":
        raise IntegrationValidationError("这个文件不能按文本预览")
    data = path.read_bytes()
    if len(data) > SKILL_MD_MAX_BYTES or b"\x00" in data:
        raise IntegrationValidationError("文件超过 256 KiB，请下载 ZIP")
    try:
        content = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise IntegrationValidationError("文件不是 UTF-8 文本") from exc
    return SkillFileTextOut(version=version, path=stored, content=content)


def read_skill_image(root: Path, relative: str) -> tuple[str, bytes, str]:
    stored, path = resolve_skill_file(root, relative)
    media_type = IMAGE_MEDIA_TYPES.get(path.suffix.casefold())
    if media_type is None or _kind(path) != "image":
        raise IntegrationValidationError("这个文件不能按图片预览")
    data = path.read_bytes()
    if len(data) > IMAGE_MAX_BYTES or not _image_signature(data, path.suffix.casefold()):
        raise IntegrationValidationError("这个文件不能按图片预览")
    return stored, data, media_type


def resolve_skill_file(root: Path, relative: str) -> tuple[str, Path]:
    pure = _pure_relative(relative)
    current = root.resolve()
    if not current.is_dir() or current.is_symlink():
        raise IntegrationNotFoundError("Skill 版本内容不存在")
    for part in pure.parts:
        if not current.is_dir() or current.is_symlink():
            raise IntegrationNotFoundError("Skill 文件不存在")
        match = next((child for child in current.iterdir() if child.name == part), None)
        if match is None:
            raise IntegrationNotFoundError("Skill 文件不存在")
        if match.is_symlink():
            raise IntegrationValidationError("Skill 文件路径无效")
        current = match
    if not current.is_file():
        raise IntegrationNotFoundError("Skill 文件不存在")
    resolved = current.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise IntegrationValidationError("Skill 文件路径无效")
    return pure.as_posix(), current


def _iter_files(root: Path) -> list[tuple[str, Path]]:
    root_resolved = root.resolve()
    found: list[tuple[str, Path]] = []
    for path in root.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        resolved = path.resolve()
        if not resolved.is_relative_to(root_resolved):
            continue
        found.append((path.relative_to(root).as_posix(), path))
    found.sort(key=lambda item: item[0])
    return found


def _pure_relative(relative: str) -> PurePosixPath:
    if (
        not relative
        or relative.strip() != relative
        or "\\" in relative
        or "\x00" in relative
        or relative.startswith("/")
    ):
        raise IntegrationValidationError("Skill 文件路径无效")
    pure = PurePosixPath(relative)
    if pure.is_absolute() or not pure.parts or any(part in {"", ".", ".."} for part in pure.parts):
        raise IntegrationValidationError("Skill 文件路径无效")
    return pure


def _kind(path: Path) -> str:
    size = path.stat().st_size
    suffix = path.suffix.casefold()
    if suffix in IMAGE_MEDIA_TYPES:
        if size > IMAGE_MAX_BYTES:
            return "other"
        with path.open("rb") as source:
            signature = source.read(16)
        return "image" if _image_signature(signature, suffix) else "other"
    if size > SKILL_MD_MAX_BYTES:
        return "other"
    with path.open("rb") as source:
        data = source.read(SKILL_MD_MAX_BYTES + 1)
    if len(data) > SKILL_MD_MAX_BYTES or b"\x00" in data:
        return "other"
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return "other"
    return "text"


def _image_signature(data: bytes, suffix: str) -> bool:
    if suffix == ".png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix in {".jpg", ".jpeg"}:
        return data.startswith(b"\xff\xd8\xff")
    if suffix == ".gif":
        return data.startswith((b"GIF87a", b"GIF89a"))
    if suffix == ".webp":
        return data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    return False
