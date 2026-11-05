"""MIME normalization and bounded byte-signature checks."""

import codecs


def normalize_content_type(raw: str | None) -> str:
    """Strip parameters; empty/missing becomes application/octet-stream."""
    value = (raw or "").lower().strip()
    if not value:
        return "application/octet-stream"
    return value.split(";", 1)[0].strip() or "application/octet-stream"


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
