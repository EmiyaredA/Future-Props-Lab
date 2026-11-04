"""Portable Galgame project asset record shared by both website assemblies."""

from copy import deepcopy

from app.apps.galgame_workshop.assets.asset_support import ProjectAssetFile
from app.apps.galgame_workshop.models import GalgameAssetMetadata


def _fallback_category(asset: ProjectAssetFile) -> str:
    return {
        "video": "video",
        "audio": "voice",
        "font": "font",
    }.get(asset.media_kind, "other")


def snapshot_asset_record(
    asset: ProjectAssetFile, metadata: GalgameAssetMetadata | None, fallback_index: int
) -> dict:
    virtual_path = (
        metadata.virtual_path
        if metadata is not None and metadata.virtual_path
        else f"assets/imported-{fallback_index:04d}-{asset.original_filename}"
    )
    return {
        "id": asset.id,
        "original_filename": asset.original_filename,
        "display_name": asset.display_name,
        "media_kind": asset.media_kind,
        "mime_type": asset.mime_type,
        "byte_size": asset.byte_size,
        "category": metadata.category if metadata else _fallback_category(asset),
        "virtual_path": virtual_path,
        "packaging_policy": metadata.packaging_policy if metadata else "auto",
        "checksum_sha256": metadata.checksum_sha256 if metadata else None,
        "width": metadata.width if metadata else None,
        "height": metadata.height if metadata else None,
        "duration_ms": metadata.duration_ms if metadata else None,
        "transcript": metadata.transcript if metadata else None,
        "transcript_language": metadata.transcript_language if metadata else None,
        "transcript_status": metadata.transcript_status if metadata else "pending",
        "transcript_source": metadata.transcript_source if metadata else None,
        "transcript_revision": metadata.transcript_revision if metadata else 0,
        "transcript_segments": deepcopy(metadata.transcript_segments or []) if metadata else [],
    }
