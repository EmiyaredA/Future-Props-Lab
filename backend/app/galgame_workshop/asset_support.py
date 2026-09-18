from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path, PurePosixPath

from PIL import Image

try:
    from tinytag import TinyTag
except ImportError:  # pragma: no cover - dependency is required in production
    TinyTag = None  # type: ignore[assignment]

from app.models import GalgameAssetMetadata, VisualAsset
from app.runtime.time import iso_utc
from app.schemas.galgame_workshop import GalgameProjectAssetOut

CATEGORY_DIRECTORIES = {
    "character": "characters",
    "scene": "backgrounds",
    "cg": "cg",
    "bgm": "bgm",
    "ambient": "se",
    "sfx": "se",
    "voice": "voice",
    "video": "video",
    "font": "fonts",
    "other": "assets",
}
RESERVED_FILENAME_RE = re.compile(r"[\x00-\x1f\x7f%#?&<>:\"|*]+")


def _default_category(row: VisualAsset) -> str:
    return "video" if row.media_kind == "video" else "font" if row.media_kind == "font" else "other"


def _default_virtual_path(row: VisualAsset, category: str | None = None) -> str:
    directory = CATEGORY_DIRECTORIES[category or _default_category(row)]
    filename = f"{row.display_name}{Path(row.original_filename).suffix.lower()}"
    return f"{directory}/{filename}"


def galgame_asset_out(
    row: VisualAsset, metadata: GalgameAssetMetadata | None = None
) -> GalgameProjectAssetOut:
    category = metadata.category if metadata else _default_category(row)
    return GalgameProjectAssetOut(
        id=row.id,
        display_name=row.display_name,
        media_kind=row.media_kind,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
        category=category,
        virtualPath=metadata.virtual_path if metadata else _default_virtual_path(row, category),
        packagingPolicy=metadata.packaging_policy if metadata else "auto",
        checksumSha256=metadata.checksum_sha256 if metadata else None,
        width=metadata.width if metadata else None,
        height=metadata.height if metadata else None,
        durationMs=metadata.duration_ms if metadata else None,
        transcript=metadata.transcript if metadata else None,
        transcriptLanguage=metadata.transcript_language if metadata else None,
        transcriptStatus=metadata.transcript_status if metadata else "pending",
        transcriptSource=metadata.transcript_source if metadata else None,
        transcriptRevision=metadata.transcript_revision if metadata else 0,
        transcriptSegments=list(metadata.transcript_segments or []) if metadata else [],
    )


def normalize_import_filename(value: str) -> tuple[str, list[str]]:
    reasons: list[str] = []
    path_normalized = value.replace("\\", "/")
    basename = PurePosixPath(path_normalized).name
    if basename != value:
        reasons.append("已移除原始路径")
    normalized = unicodedata.normalize("NFC", basename)
    cleaned = RESERVED_FILENAME_RE.sub("-", normalized)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(". ")
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    if cleaned != normalized:
        reasons.append("已替换控制字符或保留符号")
    if not cleaned or cleaned in {".", ".."}:
        suffix = Path(normalized).suffix.lower()
        cleaned = f"asset{suffix}"
        reasons.append("空文件名已使用安全名称")
    return cleaned[:255], reasons


def _deduplicated_name(name: str, used: set[str]) -> tuple[str, bool]:
    suffix = Path(name).suffix
    stem = name[: -len(suffix)] if suffix else name
    candidate = name
    index = 2
    while candidate.casefold() in used:
        candidate = f"{stem}-{index}{suffix}"
        index += 1
    used.add(candidate.casefold())
    return candidate, candidate != name


def _file_metadata(path: Path, media_kind: str) -> tuple[str, int | None, int | None, int | None]:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    if media_kind == "image":
        try:
            with Image.open(path) as image:
                width, height = image.size
        except (OSError, SyntaxError, ValueError):
            # Files uploaded by older versions were validated by signature only.
            # Keep them usable while reporting missing dimensions for maintenance.
            width = height = None
    elif media_kind in {"audio", "video"} and TinyTag is not None:
        try:
            tag = TinyTag.get(path)
            if tag.duration is not None:
                duration_ms = max(0, round(float(tag.duration) * 1000))
        except (OSError, ValueError):
            duration_ms = None
    return digest.hexdigest(), width, height, duration_ms
