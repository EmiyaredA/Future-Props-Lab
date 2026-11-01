from __future__ import annotations

import io
import re
import shutil
from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError

from app.capabilities.asset_store.incoming import IncomingFile
from app.integrations.skills.archive import SkillArchiveStorage
from app.runtime.config import Settings, get_settings

MAX_COVER_BYTES = 5 * 1024 * 1024
PRIVATE_FILE_NAMES = {".env", ".npmrc", "id_rsa", "id_ed25519", "credentials.json", "secrets.json"}
PRIVATE_TEXT = re.compile(
    rb"(?i)(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|"
    rb"authorization\s*[:=]\s*bearer\s+\S+|"
    rb"(?:api[_-]?key|client[_-]?secret|password)\s*[:=]\s*['\"]?[^\s'\"]{8,})"
)


class CreativeFileError(ValueError):
    pass


def _root(settings: Settings, owner_user_id: str) -> Path:
    return settings.account_path(owner_user_id)


def resolve_file(owner_user_id: str, relative: str, *, settings: Settings | None = None) -> Path:
    root = _root(settings or get_settings(), owner_user_id)
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise CreativeFileError("文件路径无效")
    return path


async def save_cover(owner_user_id: str, upload: IncomingFile) -> str:
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
            target = resolve_file(owner_user_id, relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(target, format="WEBP", quality=88, method=5)
            return relative
    except (UnidentifiedImageError, OSError) as exc:
        raise CreativeFileError("封面不是可读取的图片") from exc


async def save_skill_draft(
    owner_user_id: str, item_id: str, upload: IncomingFile
) -> tuple[str, dict]:
    storage = SkillArchiveStorage(get_settings(), owner_user_id)
    staged = await storage.stage(upload)
    relative = f"creative-workshop/skill-drafts/{item_id}/{uuid4().hex}"
    target = resolve_file(owner_user_id, relative)
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


def copy_skill_release(owner_user_id: str, source_relative: str, release_id: str) -> str:
    source = resolve_file(owner_user_id, source_relative)
    if not (source / "SKILL.md").is_file():
        raise CreativeFileError("Skill 文件不可用")
    for path in source.rglob("*"):
        if not path.is_file():
            continue
        if (
            path.is_symlink()
            or path.name.lower() in PRIVATE_FILE_NAMES
            or path.suffix.lower() in {".pem", ".key"}
        ):
            raise CreativeFileError("Skill 包含私有凭据文件，不能公开")
        if path.stat().st_size <= 2 * 1024 * 1024 and PRIVATE_TEXT.search(path.read_bytes()):
            raise CreativeFileError("Skill 文件疑似包含密钥，请移除后重试")
    relative = f"creative-workshop/skill-releases/{release_id}"
    target = resolve_file(owner_user_id, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target)
    return relative
