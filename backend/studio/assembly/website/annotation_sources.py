"""Website transaction adapter for authorized library audio reads."""

from contextlib import asynccontextmanager

from sqlalchemy import select

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.scope import is_library_asset
from studio.apps.audio_annotation.sources import (
    AnnotationAudio,
    AudioAnnotationError,
)
from studio.contracts.asset_library.descriptions import LibraryAssetDescription


def audio(row):
    return AnnotationAudio(
        LibraryAssetDescription.model_validate(row, from_attributes=True),
        row.owner_user_id,
        row.display_name,
    )


class WebsiteAnnotationSources:
    def __init__(self, session, settings):
        self.session, self.settings = session, settings
        self.storage = AssetStorage(self.settings)

    async def describe(self, asset_id):
        row = await self.session.get(VisualAsset, asset_id)
        if row is not None and not is_library_asset(row):
            raise AudioAnnotationError("只能使用账号文件库中的音频", code="scope_mismatch")
        return audio(row) if row is not None else None

    async def describe_many(self, asset_ids):
        if not asset_ids:
            return {}
        rows = await self.session.scalars(select(VisualAsset).where(VisualAsset.id.in_(asset_ids)))
        return {row.id: audio(row) for row in rows if is_library_asset(row)}

    @asynccontextmanager
    async def open(self, asset):
        row = await self.session.get(VisualAsset, asset.id)
        if row is None or not is_library_asset(row):
            raise AudioAnnotationError("音频文件不存在", code="not_found", status=404)
        path = self.storage.path_for(row)
        if not path.is_file():
            raise AudioAnnotationError("音频文件内容不存在", code="file_missing", status=404)
        yield path
