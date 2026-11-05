from __future__ import annotations

import io
import re
import shutil
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from studio.config.settings import get_settings
from studio.contracts.asset_library.incoming import IncomingFile

MAX_COVER_BYTES = 5 * 1024 * 1024
PRIVATE_FILE_NAMES = {".env", ".npmrc", "id_rsa", "id_ed25519", "credentials.json", "secrets.json"}
PRIVATE_TEXT = re.compile(
    rb"(?i)(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    rb"authorization\s*[:=]\s*bearer\s+\S+|"
    rb"(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*['\"]?[^\s'\"]{8,})"
)


class CreativeFileError(ValueError):
    pass


class CreativeFileSettings(Protocol):
    @property
    def runtime_path(self) -> Path: ...

    @property
    def fpl_skill_archive_max_bytes(self) -> int: ...


def resolve_file(
    owner_user_id: str, relative: str, *, settings: CreativeFileSettings | None = None
) -> Path:
    settings = settings or get_settings()
    if (
        not owner_user_id
        or owner_user_id in {".", ".."}
        or Path(owner_user_id).name != owner_user_id
    ):
        raise CreativeFileError("账号标识无效")
    root = settings.runtime_path
    parts = ("accounts", owner_user_id, *Path(relative).parts)
    if not relative or Path(relative).is_absolute() or any(part in {".", ".."} for part in parts):
        raise CreativeFileError("文件路径无效")
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise CreativeFileError("文件路径不能包含符号链接")
    if not path.resolve().is_relative_to((root / "accounts" / owner_user_id).resolve()):
        raise CreativeFileError("文件路径无效")
    return path


async def save_cover(
    owner_user_id: str, upload: IncomingFile, *, settings: CreativeFileSettings | None = None
) -> str:
    payload = bytearray()
    try:
        while chunk := await upload.read(1024 * 1024):
            payload.extend(chunk)
            if len(payload) > MAX_COVER_BYTES:
                raise CreativeFileError("封面超过 5 MiB")
    finally:
        await upload.close()
    try:
        with Image.open(io.BytesIO(payload)) as image:
            if image.format not in {"PNG", "JPEG", "WEBP"} or getattr(image, "is_animated", False):
                raise CreativeFileError("封面仅支持静态 PNG、JPEG 或 WebP")
            if image.width * image.height > 30_000_000:
                raise CreativeFileError("封面像素数量过大")
            image.load()
            image = image.convert("RGB")
            if image.width < 320 or image.height < 180:
                raise CreativeFileError("封面尺寸过小")
            image.thumbnail((1200, 675), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (1200, 675), "#f8ede5")
            canvas.paste(image, ((1200 - image.width) // 2, (675 - image.height) // 2))
            relative = f"creative-workshop/covers/{uuid4().hex}.webp"
            target = resolve_file(owner_user_id, relative, settings=settings)
            target.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(target, format="WEBP", quality=88, method=5)
            return relative
    except (UnidentifiedImageError, OSError) as exc:
        raise CreativeFileError("封面不是可读取的图片") from exc


async def save_skill_draft(
    owner_user_id: str,
    item_id: str,
    upload: IncomingFile,
    *,
    archive_parser,
    settings: CreativeFileSettings | None = None,
) -> tuple[str, dict]:
    stage_root = resolve_file(owner_user_id, "creative-workshop/.staging", settings=settings)
    staged = await archive_parser.stage(owner_user_id, upload)
    stage = staged.directory
    if stage.is_symlink() or not stage.resolve().is_relative_to(stage_root.resolve()):
        raise CreativeFileError("Skill 暂存目录无效")
    relative = f"creative-workshop/skill-drafts/{item_id}/{uuid4().hex}"
    target = resolve_file(owner_user_id, relative, settings=settings)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        staged.directory.rename(target)
    except Exception:
        shutil.rmtree(staged.directory, ignore_errors=True)
        raise
    return relative, {
        "name": staged.name,
        "description": staged.description,
        "content_sha256": staged.sha256,
        "file_count": staged.file_count,
        "expanded_bytes": staged.expanded_bytes,
    }


def copy_skill_release(
    owner_user_id: str,
    source_relative: str,
    release_id: str,
    *,
    settings: CreativeFileSettings | None = None,
) -> str:
    source = resolve_file(owner_user_id, source_relative, settings=settings)
    if not (source / "SKILL.md").is_file():
        raise CreativeFileError("Skill 文件不可用")
    for path in source.rglob("*"):
        if path.is_symlink():
            raise CreativeFileError("Skill 不能包含符号链接")
        if not path.is_file():
            continue
        if path.name.lower() in PRIVATE_FILE_NAMES or path.suffix.lower() in {".pem", ".key"}:
            raise CreativeFileError("Skill 包含私有凭据文件，不能公开")
        if path.stat().st_size <= 2 * 1024 * 1024 and PRIVATE_TEXT.search(path.read_bytes()):
            raise CreativeFileError("Skill 文件疑似包含密钥，请移除后重试")
    relative = f"creative-workshop/skill-releases/{release_id}"
    target = resolve_file(owner_user_id, relative, settings=settings)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target)
    return relative
