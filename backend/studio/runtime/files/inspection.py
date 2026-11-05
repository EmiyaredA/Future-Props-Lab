"""Validate complete files without extracting or executing their content."""

import json
import zipfile
from pathlib import Path


def validate_json_file(path: Path) -> bool:
    try:
        with path.open(encoding="utf-8-sig") as source:
            json.load(source)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        return False
    return True


def validate_file_structure(path: Path, extension: str) -> bool:
    """Validate complete text and archive structure without extracting file contents."""
    if extension == ".svg":
        from studio.runtime.files.svg import MAX_SVG_BYTES, normalize_svg

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
