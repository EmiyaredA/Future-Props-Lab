"""Compatibility motion project layouts and project-local asset checks."""

from sqlalchemy import select

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.project_transactions import (
    creating_project_layout,
    deleting_project_layout,
)
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.motion_document import MotionComposition
from app.runtime.config import get_settings
from studio.apps.motion_compositor.projects import MotionInvalid


class LegacyProjectResources:
    def __init__(self, session, owner_user_id):
        self.session, self.owner_user_id = session, owner_user_id
        self.storage = AssetStorage(get_settings())

    def create_layout(self, identity):
        return creating_project_layout(
            self.session,
            self.storage,
            "motion-compositor",
            identity,
            owner_user_id=self.owner_user_id,
        )

    def delete_layout(self, identity, _revision):
        return deleting_project_layout(
            self.session,
            self.storage,
            "motion-compositor",
            identity,
            owner_user_id=self.owner_user_id,
        )

    async def validate_assets(self, project_id: str, document: MotionComposition) -> None:
        ids = {layer.asset_id for layer in document.layers if layer.asset_id}
        if not ids:
            return
        rows = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.id.in_(ids),
                        VisualAsset.motion_compositor_project_id == project_id,
                        VisualAsset.owner_user_id == self.owner_user_id,
                    )
                )
            ).scalars()
        )
        assets = {row.id: row for row in rows}
        if set(assets) != ids:
            raise MotionInvalid("文档引用了不属于此项目的素材")
        if any(
            assets[layer.asset_id].media_kind != layer.kind
            for layer in document.layers
            if layer.asset_id
        ):
            raise MotionInvalid("素材类型与图层类型不一致")
