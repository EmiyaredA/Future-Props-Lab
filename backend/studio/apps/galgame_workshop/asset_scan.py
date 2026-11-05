"""Persist a Galgame metadata scan from the Assets-owned originals."""

from sqlalchemy import text

from studio.apps.galgame_workshop.assets.asset_support import (
    _default_category,
    _default_virtual_path,
    galgame_asset_out,
)
from studio.apps.galgame_workshop.schemas import GalgameProjectAssetListOut
from studio.apps.galgame_workshop.storage.models import GalgameAssetMetadata
from studio.runtime.project_errors import ProjectResourceError


async def scan_metadata(files, project_id):
    await files.projects.row(project_id)
    rows = await files.asset_records(project_id, (), newest_first=False, scan=True)
    session = files.session
    await session.rollback()
    await session.execute(text("BEGIN IMMEDIATE"))
    await files.projects.row(project_id)
    results = []
    for row, _ in rows:
        metadata = await session.get(GalgameAssetMetadata, row.id)
        if metadata is not None and metadata.project_id != project_id:
            raise ProjectResourceError("素材元数据不属于当前项目", "asset_metadata_scope", 409)
        if row.inspection is not None:
            if metadata is None:
                metadata = GalgameAssetMetadata(
                    asset_id=row.id,
                    project_id=project_id,
                    category=_default_category(row),
                    virtual_path=_default_virtual_path(row),
                    transcript_status="pending" if row.media_kind == "audio" else "ready",
                )
                session.add(metadata)
            metadata.checksum_sha256 = row.inspection.sha256
            metadata.width = row.inspection.width
            metadata.height = row.inspection.height
            metadata.duration_ms = row.inspection.duration_ms
        results.append((row, metadata))
    await session.flush()
    result = GalgameProjectAssetListOut(
        items=[galgame_asset_out(row, metadata) for row, metadata in results]
    )
    await session.commit()
    return result
