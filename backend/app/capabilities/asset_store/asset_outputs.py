from datetime import datetime
from typing import Protocol

from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualAssetFolder,
)
from app.capabilities.asset_store.policy import display_name_without_original_extension
from app.capabilities.asset_store.schemas.files import VisualAssetFolderOut, VisualAssetOut
from app.runtime.time import iso_utc


class AssetReferenceView(Protocol):
    id: str
    project_id: str
    folder_id: str | None
    display_name: str
    revision: int
    created_at: datetime
    updated_at: datetime


def folder_out(row: VisualAssetFolder) -> VisualAssetFolderOut:
    return VisualAssetFolderOut(
        id=row.id,
        project_id=row.project_id,
        parent_id=row.parent_id,
        name=row.name,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )


def asset_out(
    row: VisualAsset,
    *,
    reference: AssetReferenceView | None = None,
) -> VisualAssetOut:
    display_name = reference.display_name if reference else row.display_name
    return VisualAssetOut(
        id=row.id,
        project_id=reference.project_id if reference else row.project_id,
        folder_id=reference.folder_id if reference else row.folder_id,
        original_filename=row.original_filename,
        display_name=display_name_without_original_extension(
            display_name,
            row.original_filename,
        ),
        media_kind=row.media_kind,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
        revision=reference.revision if reference else row.revision,
        created_at=iso_utc(reference.created_at if reference else row.created_at),
        updated_at=iso_utc(reference.updated_at if reference else row.updated_at),
        source="library" if row.project_id is None else "project",
        is_reference=reference is not None,
        reference_id=reference.id if reference else None,
    )
