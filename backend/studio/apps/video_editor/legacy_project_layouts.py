"""Compatibility Video project storage layouts."""

from contextlib import asynccontextmanager

from sqlalchemy import select

from studio.apps.asset_library.storage.file_paths import TARGET_STORAGE_VERSION, AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.config.settings import get_settings
from studio.runtime.database.project_files import creating_project_layout, deleting_project_layout


class LegacyVideoLayouts:
    def __init__(self, session, owner_user_id):
        self.session, self.owner_user_id = session, owner_user_id
        self.storage = AssetStorage(get_settings())

    def create_layout(self, project_id):
        return creating_project_layout(
            self.session, self.storage, "video-editor", project_id, owner_user_id=self.owner_user_id
        )

    @asynccontextmanager
    async def delete_layout(self, project_id, _revision):
        assets = (
            (
                await self.session.execute(
                    select(VisualAsset).where(VisualAsset.video_editor_project_id == project_id)
                )
            )
            .scalars()
            .all()
        )
        legacy = [
            self.storage.path_for(asset)
            for asset in assets
            if asset.storage_version < TARGET_STORAGE_VERSION
        ]
        async with deleting_project_layout(
            self.session,
            self.storage,
            "video-editor",
            project_id,
            owner_user_id=self.owner_user_id,
            legacy_paths=legacy,
        ):
            yield
