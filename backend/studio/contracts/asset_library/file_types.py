"""Declared upload and attachment formats; no filesystem inspection."""

from types import MappingProxyType

ALLOWED_FILES = MappingProxyType(
    {
        ".svg": ("image", frozenset({"image/svg+xml"})),
        ".jpg": ("image", frozenset({"image/jpeg"})),
        ".jpeg": ("image", frozenset({"image/jpeg"})),
        ".png": ("image", frozenset({"image/png"})),
        ".webp": ("image", frozenset({"image/webp"})),
        ".gif": ("image", frozenset({"image/gif"})),
        ".avif": ("image", frozenset({"image/avif"})),
        ".mp4": ("video", frozenset({"video/mp4"})),
        ".webm": ("video", frozenset({"video/webm"})),
        ".mov": ("video", frozenset({"video/quicktime"})),
        ".mkv": (
            "video",
            frozenset(
                {
                    "video/x-matroska",
                    "video/matroska",
                    "application/x-matroska",
                    "application/octet-stream",
                }
            ),
        ),
        ".mp3": ("audio", frozenset({"audio/mpeg"})),
        ".wav": ("audio", frozenset({"audio/wav", "audio/x-wav"})),
        ".m4a": ("audio", frozenset({"audio/mp4", "audio/x-m4a"})),
        ".ogg": ("audio", frozenset({"audio/ogg"})),
        ".aac": ("audio", frozenset({"audio/aac", "application/octet-stream"})),
        ".flac": ("audio", frozenset({"audio/flac", "audio/x-flac"})),
        ".ttf": (
            "font",
            frozenset({"font/ttf", "application/x-font-ttf", "application/octet-stream"}),
        ),
        ".otf": (
            "font",
            frozenset({"font/otf", "application/x-font-opentype", "application/octet-stream"}),
        ),
        ".woff": (
            "font",
            frozenset({"font/woff", "application/font-woff", "application/octet-stream"}),
        ),
        ".woff2": ("font", frozenset({"font/woff2", "application/octet-stream"})),
        ".doc": ("document", frozenset({"application/msword"})),
        ".xls": ("document", frozenset({"application/vnd.ms-excel"})),
        ".ppt": ("document", frozenset({"application/vnd.ms-powerpoint"})),
        ".docx": (
            "document",
            frozenset({"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}),
        ),
        ".xlsx": (
            "document",
            frozenset({"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),
        ),
        ".pptx": (
            "document",
            frozenset(
                {"application/vnd.openxmlformats-officedocument.presentationml.presentation"}
            ),
        ),
        ".csv": (
            "document",
            frozenset({"text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"}),
        ),
        ".zip": ("document", frozenset({"application/zip", "application/x-zip-compressed"})),
        ".pdf": ("document", frozenset({"application/pdf"})),
        ".txt": ("document", frozenset({"text/plain"})),
        ".md": ("document", frozenset({"text/markdown", "text/plain"})),
        ".json": ("document", frozenset({"application/json", "text/json", "text/plain"})),
    }
)
REFERENCE_IMAGE_MIME_TYPES = frozenset(
    frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"})
)
GALGAME_EXTENSIONS = frozenset(
    {
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
)
VIDEO_EDITABLE_EXTENSIONS = frozenset(
    {
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
)
ATTACHMENT_EXTENSIONS = frozenset(
    {
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
)
