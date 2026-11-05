"""Safe display and download names independent of account storage."""

from pathlib import Path


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
