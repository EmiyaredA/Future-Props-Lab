"""Recovery-site adapter for unmigrated generation references; never loaded by Models."""

from sqlalchemy import select

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage

from .generation_assets import ROLE_FIELDS, LegacyAssetSource, reference_ids


class LegacyGenerationReferences:
    def __init__(self, settings):
        self.storage = AssetStorage(settings)

    async def path(self, session, task, asset_id, expected_kind):
        row = await session.scalar(
            select(VisualAsset).where(
                VisualAsset.id == asset_id, VisualAsset.owner_user_id == task.owner_user_id
            )
        )
        if row is None or row.media_kind != expected_kind:
            raise ValueError("参考素材已不存在或类型不匹配")
        path = self.storage.path_for(row)
        if path.is_symlink() or not path.is_file():
            raise ValueError("参考素材文件不存在")
        return path, row.mime_type

    async def assets(self, session, task):
        ids = [
            str(item)
            for field, _role, _kind in ROLE_FIELDS
            for item in reference_ids(task.request_payload, field)
        ]
        rows = await session.scalars(
            select(VisualAsset).where(
                VisualAsset.id.in_(ids), VisualAsset.owner_user_id == task.owner_user_id
            )
        )
        by_id = {row.id: row for row in rows}
        result = {}
        for field, _role, expected_kind in ROLE_FIELDS:
            items = []
            for asset_id in reference_ids(task.request_payload, field):
                row = by_id.get(str(asset_id))
                if row is None or row.media_kind != expected_kind:
                    return None
                path = self.storage.path_for(row)
                if path.is_symlink() or not path.is_file():
                    return None
                items.append(
                    LegacyAssetSource(
                        id=row.id,
                        original_filename=row.original_filename,
                        media_kind=row.media_kind,
                        mime_type=row.mime_type,
                        byte_size=row.byte_size,
                        path=path,
                    )
                )
            result[field] = items
        return result
