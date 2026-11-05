"""Portable Motion archive naming shared by both website assemblies."""

from pathlib import Path

from fpl_runtime.motion_snapshot import MAX_ARCHIVE_BYTES as MAX_ARCHIVE_BYTES

FORMAT = "future-props-motion-project-v1"


def archive_asset(asset):
    suffix = Path(asset.original_filename).suffix.lower()
    return {
        "id": asset.id,
        "name": f"assets/{asset.id}{suffix}",
        "filename": asset.original_filename,
        "mimeType": asset.mime_type,
    }


def archive_manifest(title, document, assets):
    return {
        "format": FORMAT,
        "title": title,
        "document": document.model_dump(mode="json", by_alias=True),
        "assets": assets,
    }
