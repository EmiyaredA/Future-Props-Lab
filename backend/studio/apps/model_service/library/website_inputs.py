"""Recovery website adapter; independent Models must use its HTTP input port."""

from contextlib import asynccontextmanager

from sqlalchemy import select

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.model_service.library.inputs import LibraryInput, LocalInput
from studio.contracts.asset_library.errors import AssetError


class LegacyLibraryInputs:
    def __init__(self, session, settings, owner_user_id):
        self.session, self.owner, self.storage = session, owner_user_id, AssetStorage(settings)

    @asynccontextmanager
    async def open(self, asset_id):
        if self.session.info.get("owner_user_id") != self.owner:
            raise ValueError("素材输入缺少匹配的账号上下文")
        asset = await self.session.scalar(
            select(VisualAsset).where(
                VisualAsset.id == asset_id,
                VisualAsset.owner_user_id == self.owner,
                VisualAsset.project_id.is_(None),
                VisualAsset.galgame_project_id.is_(None),
                VisualAsset.video_editor_project_id.is_(None),
                VisualAsset.motion_compositor_project_id.is_(None),
            )
        )
        if asset is None:
            raise AssetError("文件管理中的素材不存在", code="not_found", status=404)
        path = self.storage.path_for(asset)
        metadata = (
            asset.id,
            asset.media_kind,
            asset.byte_size,
            asset.original_filename,
            asset.mime_type,
        )
        await self.session.rollback()
        if path.is_symlink() or not path.is_file():
            raise AssetError("源素材内容不存在", code="not_found", status=404)
        incoming = LocalInput(path, metadata[3], metadata[4])
        try:
            yield LibraryInput(metadata[0], metadata[1], metadata[2], incoming)
        finally:
            await incoming.close()
