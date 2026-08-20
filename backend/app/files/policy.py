from __future__ import annotations

import codecs
import json
from pathlib import Path

ALLOWED_FILES: dict[str, tuple[str, set[str]]] = {
    ".jpg": ("image", {"image/jpeg"}),
    ".jpeg": ("image", {"image/jpeg"}),
    ".png": ("image", {"image/png"}),
    ".webp": ("image", {"image/webp"}),
    ".gif": ("image", {"image/gif"}),
    ".avif": ("image", {"image/avif"}),
    ".mp4": ("video", {"video/mp4"}),
    ".webm": ("video", {"video/webm"}),
    ".mov": ("video", {"video/quicktime"}),
    ".mp3": ("audio", {"audio/mpeg"}),
    ".wav": ("audio", {"audio/wav", "audio/x-wav"}),
    ".m4a": ("audio", {"audio/mp4", "audio/x-m4a"}),
    ".ogg": ("audio", {"audio/ogg"}),
    ".ttf": ("font", {"font/ttf", "application/x-font-ttf", "application/octet-stream"}),
    ".otf": (
        "font",
        {"font/otf", "application/x-font-opentype", "application/octet-stream"},
    ),
    ".woff": ("font", {"font/woff", "application/font-woff", "application/octet-stream"}),
    ".woff2": ("font", {"font/woff2", "application/octet-stream"}),
    ".pdf": ("document", {"application/pdf"}),
    ".txt": ("document", {"text/plain"}),
    ".md": ("document", {"text/markdown", "text/plain"}),
    ".json": ("document", {"application/json", "text/json", "text/plain"}),
}

GALGAME_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".avif",
    ".mp3",
    ".wav",
    ".m4a",
    ".ogg",
    ".mp4",
    ".webm",
    ".mov",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
    ".pdf",
    ".txt",
    ".md",
    ".json",
}


def looks_like(extension: str, head: bytes) -> bool:
    if extension in {".txt", ".md", ".json"}:
        try:
            decoded = codecs.getincrementaldecoder("utf-8")().decode(head, final=False)
            return b"\x00" not in head and bool(decoded)
        except UnicodeDecodeError:
            return False
    checks = {
        ".jpg": head.startswith(b"\xff\xd8\xff"),
        ".jpeg": head.startswith(b"\xff\xd8\xff"),
        ".png": head.startswith(b"\x89PNG\r\n\x1a\n"),
        ".webp": head.startswith(b"RIFF") and head[8:12] == b"WEBP",
        ".gif": head.startswith((b"GIF87a", b"GIF89a")),
        ".avif": b"ftypavif" in head[:32] or b"ftypavis" in head[:32],
        ".mp4": b"ftyp" in head[4:16],
        ".mov": b"ftyp" in head[4:16],
        ".webm": head.startswith(b"\x1aE\xdf\xa3"),
        ".mp3": head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF),
        ".wav": head.startswith(b"RIFF") and head[8:12] == b"WAVE",
        ".m4a": b"ftyp" in head[4:16],
        ".ogg": head.startswith(b"OggS"),
        ".ttf": head.startswith((b"\x00\x01\x00\x00", b"true", b"typ1")),
        ".otf": head.startswith(b"OTTO"),
        ".woff": head.startswith(b"wOFF"),
        ".woff2": head.startswith(b"wOF2"),
        ".pdf": head.startswith(b"%PDF-"),
    }
    return checks.get(extension, False)


def validate_json_file(path: Path) -> bool:
    try:
        with path.open(encoding="utf-8-sig") as source:
            json.load(source)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        return False
    return True


def display_name_without_original_extension(display_name: str, original_filename: str) -> str:
    cleaned = display_name.strip()
    extension = Path(original_filename).suffix
    if not extension or len(cleaned) <= len(extension):
        return cleaned
    if cleaned.lower().endswith(extension.lower()):
        return cleaned[: -len(extension)].strip() or cleaned
    return cleaned


def download_filename(display_name: str, original_filename: str) -> str:
    base = display_name_without_original_extension(display_name, original_filename)
    safe_base = base.replace("/", "-").replace("\\", "-").strip()
    fallback = display_name_without_original_extension(original_filename, original_filename)
    return f"{safe_base or fallback or 'download'}{Path(original_filename).suffix}"
