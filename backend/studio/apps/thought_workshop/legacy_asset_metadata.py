"""Explicit recovery-site adapter. Independent Thought never loads Assets ORM."""

import asyncio
import shutil

from sqlalchemy import select

from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.website.asset_metadata import LibraryAsset


class LegacyAssetMetadata:
    def __init__(self, session, owner_user_id, *, storage):
        self.session, self.owner = session, owner_user_id
        self.storage = storage

    async def describe(self, asset_ids):
        if not asset_ids:
            return {}
        rows = (
            await self.session.scalars(
                select(VisualAsset).where(
                    VisualAsset.id.in_(asset_ids),
                    VisualAsset.owner_user_id == self.owner,
                    VisualAsset.project_id.is_(None),
                    VisualAsset.galgame_project_id.is_(None),
                    VisualAsset.video_editor_project_id.is_(None),
                    VisualAsset.motion_compositor_project_id.is_(None),
                )
            )
        ).all()
        if {row.id for row in rows} != set(asset_ids):
            raise ThoughtError("素材不存在或不属于当前公共文件库", 404, "not_found")
        return {
            row.id: LibraryAsset(
                row.id,
                row.original_filename,
                row.mime_type,
                row.media_kind,
                row.byte_size,
                row.revision,
            )
            for row in rows
        }

    async def download(self, asset, target):
        row = await self.session.scalar(
            select(VisualAsset).where(
                VisualAsset.id == asset.id,
                VisualAsset.owner_user_id == self.owner,
            )
        )
        if row is None or row.revision != asset.revision:
            raise ThoughtError("素材版本已变化，请重新导出", 409, "asset_version_changed")
        source = self.storage.path_for(row)
        if source.is_symlink() or not source.is_file() or source.stat().st_size != asset.byte_size:
            raise ThoughtError("素材不存在或内容已变化", 404, "not_found")

        def copy():
            with source.open("rb") as incoming, target.open("xb") as outgoing:
                shutil.copyfileobj(incoming, outgoing)

        await asyncio.to_thread(copy)
        return target
