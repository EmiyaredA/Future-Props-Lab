from __future__ import annotations

import codecs
import json
import zipfile
from pathlib import Path

ALLOWED_FILES: dict[str, tuple[str, set[str]]] = {
    ".svg": ("image", {"image/svg+xml"}),
    ".jpg": ("image", {"image/jpeg"}),
    ".jpeg": ("image", {"image/jpeg"}),
    ".png": ("image", {"image/png"}),
    ".webp": ("image", {"image/webp"}),
    ".gif": ("image", {"image/gif"}),
    ".avif": ("image", {"image/avif"}),
    ".mp4": ("video", {"video/mp4"}),
    ".webm": ("video", {"video/webm"}),
    ".mov": ("video", {"video/quicktime"}),
    ".mkv": ("video", {"video/x-matroska", "application/octet-stream"}),
    ".mp3": ("audio", {"audio/mpeg"}),
    ".wav": ("audio", {"audio/wav", "audio/x-wav"}),
    ".m4a": ("audio", {"audio/mp4", "audio/x-m4a"}),
    ".ogg": ("audio", {"audio/ogg"}),
    ".aac": ("audio", {"audio/aac", "application/octet-stream"}),
    ".flac": ("audio", {"audio/flac", "audio/x-flac"}),
    ".ttf": ("font", {"font/ttf", "application/x-font-ttf", "application/octet-stream"}),
    ".otf": (
        "font",
        {"font/otf", "application/x-font-opentype", "application/octet-stream"},
    ),
    ".woff": ("font", {"font/woff", "application/font-woff", "application/octet-stream"}),
    ".woff2": ("font", {"font/woff2", "application/octet-stream"}),
    ".doc": ("document", {"application/msword"}),
    ".xls": ("document", {"application/vnd.ms-excel"}),
    ".ppt": ("document", {"application/vnd.ms-powerpoint"}),
    ".docx": (
        "document",
        {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ),
    ".xlsx": ("document", {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),
    ".pptx": (
        "document",
        {"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
    ),
    ".csv": ("document", {"text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"}),
    ".zip": ("document", {"application/zip", "application/x-zip-compressed"}),
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

VIDEO_EDITABLE_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".mkv",
    ".webm",
    ".wav",
    ".mp3",
    ".m4a",
    ".aac",
    ".flac",
    ".ogg",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
}


def looks_like(extension: str, head: bytes) -> bool:
    if extension == ".svg":
        return bool(head.strip())
    if extension in {".txt", ".md", ".json", ".csv"}:
        try:
            decoded = codecs.getincrementaldecoder("utf-8")().decode(head, final=False)
            return b"\x00" not in head and bool(decoded)
        except UnicodeDecodeError:
            return False
    if extension in {".doc", ".xls", ".ppt"}:
        return head.startswith(bytes.fromhex("d0cf11e0a1b11ae1"))
    if extension in {".zip", ".docx", ".xlsx", ".pptx"}:
        return head.startswith((b"PK\x03\x04", b"PK\x05\x06"))
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
        ".mkv": head.startswith(b"\x1aE\xdf\xa3"),
        ".mp3": head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF),
        ".wav": head.startswith(b"RIFF") and head[8:12] == b"WAVE",
        ".m4a": b"ftyp" in head[4:16],
        ".ogg": head.startswith(b"OggS"),
        ".aac": head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF),
        ".flac": head.startswith(b"fLaC"),
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


ATTACHMENT_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".zip",
}


def validate_file_structure(path: Path, extension: str) -> bool:
    """Validate complete text and archive structure without extracting file contents."""
    if extension == ".svg":
        from app.files.svg import MAX_SVG_BYTES, normalize_svg

        if path.stat().st_size > MAX_SVG_BYTES:
            return False
        try:
            normalize_svg(path.read_text(encoding="utf-8-sig"))
            return True
        except ValueError:
            return False
    if extension == ".json":
        return validate_json_file(path)
    if extension in {".txt", ".md", ".csv"}:
        try:
            with path.open(encoding="utf-8-sig") as source:
                while chunk := source.read(1024 * 1024):
                    if "\x00" in chunk:
                        return False
            return True
        except UnicodeDecodeError:
            return False
    if extension in {".zip", ".docx", ".xlsx", ".pptx"}:
        try:
            with zipfile.ZipFile(path) as archive:
                names = set(archive.namelist())
                required = {
                    ".docx": "word/document.xml",
                    ".xlsx": "xl/workbook.xml",
                    ".pptx": "ppt/presentation.xml",
                }
                if extension != ".zip":
                    if not {"[Content_Types].xml", "_rels/.rels", required[extension]} <= names:
                        return False
                    for name in ("[Content_Types].xml", "_rels/.rels", required[extension]):
                        info = archive.getinfo(name)
                        if info.file_size == 0 or info.flag_bits & 1:
                            return False
                return True
        except (OSError, ValueError, zipfile.BadZipFile):
            return False
    return True
