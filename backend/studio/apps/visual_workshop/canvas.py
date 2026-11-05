"""Compatibility-site canvas adapter for the shared Assets database."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.models import VisualAsset, VisualProjectAssetReference
from studio.apps.visual_workshop.canvas_asset_values import existing_assets, expected_assets
from studio.apps.visual_workshop.canvas_documents import CanvasDocuments
from studio.apps.visual_workshop.canvas_documents import VisualCanvasError as VisualCanvasError
from studio.apps.visual_workshop.canvas_values import canvas_out as canvas_out
from studio.apps.visual_workshop.schemas.workshop import VisualCanvasNode


class VisualCanvasDocuments(CanvasDocuments):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, validate_assets=self._validate_assets)

    async def _validate_assets(
        self,
        project_id: str,
        nodes: list[VisualCanvasNode],
        current_nodes: list[dict],
    ) -> None:
        expected = expected_assets(nodes)
        if not expected:
            return
        expected_ids = {asset_id for asset_id, _ in expected}
        rows = (
            (
                await self.session.execute(
                    select(VisualAsset).where(VisualAsset.id.in_(expected_ids))
                )
            )
            .scalars()
            .all()
        )
        assets = {row.id: row for row in rows}
        public_ids = [row.id for row in rows if row.project_id is None]
        references = set()
        if public_ids:
            references = set(
                (
                    await self.session.execute(
                        select(VisualProjectAssetReference.asset_id).where(
                            VisualProjectAssetReference.project_id == project_id,
                            VisualProjectAssetReference.asset_id.in_(public_ids),
                        )
                    )
                )
                .scalars()
                .all()
            )
        existing_asset_ids = existing_assets(current_nodes)
        for asset_id, kind in expected:
            asset = assets.get(asset_id)
            if asset is None:
                if asset_id in existing_asset_ids:
                    continue
                raise VisualCanvasError("节点素材不存在", code="asset_not_found")
            if asset.media_kind != kind:
                raise VisualCanvasError("节点与素材类型不匹配", code="asset_kind_mismatch")
            if asset.project_id != project_id and asset.id not in references:
                if asset_id in existing_asset_ids:
                    continue
                raise VisualCanvasError("节点素材不属于当前项目", code="scope_mismatch")
