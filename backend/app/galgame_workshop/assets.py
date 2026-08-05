from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import Settings
from app.core.time import iso_utc
from app.files import AssetError, VisualAssets
from app.galgame_workshop.errors import GalgameWorkshopProjectNotFoundError
from app.models import (
    GalgameProjectAssetReference,
    GalgameWorkshopProject,
    VisualAsset,
)
from app.schemas.galgame_workshop import (
    GalgameProjectAssetListOut,
    GalgameProjectAssetOut,
)


def galgame_asset_out(row: VisualAsset) -> GalgameProjectAssetOut:
    return GalgameProjectAssetOut(
        id=row.id,
        display_name=row.display_name,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )


class GalgameProjectAssets:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    async def _project(self, project_id: str) -> GalgameWorkshopProject:
        row = await self.session.get(GalgameWorkshopProject, project_id)
        if row is None:
            raise GalgameWorkshopProjectNotFoundError("项目不存在")
        return row

    async def list(self, project_id: str, *, query: str = "") -> GalgameProjectAssetListOut:
        await self._project(project_id)
        conditions = [VisualAsset.galgame_project_id == project_id]
        if query:
            conditions.append(VisualAsset.display_name.ilike(f"%{query}%"))
        rows = (
            (
                await self.session.execute(
                    select(VisualAsset)
                    .where(*conditions)
                    .order_by(VisualAsset.updated_at.desc(), VisualAsset.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return GalgameProjectAssetListOut(items=[galgame_asset_out(row) for row in rows])

    async def upload(self, project_id: str, upload: UploadFile) -> GalgameProjectAssetOut:
        await self._project(project_id)
        row = await VisualAssets(self.session, self.settings).upload_for_galgame(
            upload, project_id=project_id
        )
        return galgame_asset_out(row)

    async def delete(self, project_id: str, asset_id: str, expected_revision: int) -> Path:
        await self._project(project_id)
        row = await self.session.get(VisualAsset, asset_id)
        if row is None or row.galgame_project_id != project_id:
            raise AssetError("工程素材不存在", code="not_found", status=404)
        reference = await self.session.scalar(
            select(GalgameProjectAssetReference.id)
            .where(GalgameProjectAssetReference.asset_id == asset_id)
            .limit(1)
        )
        if reference:
            raise AssetError(
                "图片仍被故事使用，请先移除角色或场景引用",
                code="asset_in_use",
                status=409,
            )
        path = self.settings.visual_asset_path / row.storage_key
        result = await self.session.execute(
            delete(VisualAsset).where(
                VisualAsset.id == asset_id,
                VisualAsset.galgame_project_id == project_id,
                VisualAsset.revision == expected_revision,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.session.get(VisualAsset, asset_id)
            if current is None or current.galgame_project_id != project_id:
                raise AssetError("工程素材不存在", code="not_found", status=404)
            raise RevisionConflictError(
                expected_revision,
                current.revision,
                galgame_asset_out(current).model_dump(mode="json"),
            )
        await self.session.commit()
        path.unlink(missing_ok=True)
        return path
