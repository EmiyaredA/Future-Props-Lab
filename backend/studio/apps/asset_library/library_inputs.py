"""A Models input can read an owned library file, never another project's storage."""

from sqlalchemy import select

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from studio.runtime.files.incoming import ModelInputDescription


class LibraryInputFiles:
    def __init__(self, session, settings, owner):
        if session.info.get("owner_user_id") != owner:
            raise ValueError("素材输入缺少匹配的账号上下文")
        self.session, self.storage, self.owner = session, AssetStorage(settings), owner

    async def get(self, asset_id):
        row = await self.session.scalar(
            select(VisualAsset).where(
                VisualAsset.id == asset_id,
                VisualAsset.owner_user_id == self.owner,
                VisualAsset.project_id.is_(None),
                VisualAsset.galgame_project_id.is_(None),
                VisualAsset.video_editor_project_id.is_(None),
                VisualAsset.motion_compositor_project_id.is_(None),
            )
        )
        if row is None:
            raise AssetError("文件管理中的素材不存在", code="not_found", status=404)
        if row.media_kind not in {"image", "audio", "video"}:
            raise AssetError("此文件不能作为模型输入", code="unsupported_file_type")
        path = self.storage.path_for(row)
        if path.is_symlink() or not path.is_file():
            raise AssetError("源素材内容不存在", code="not_found", status=404)
        if path.stat().st_size != row.byte_size:
            raise AssetError("源素材大小与记录不一致", code="source_changed", status=503)
        return ModelInputDescription(
            row.original_filename, row.media_kind, row.mime_type, row.byte_size, row.revision
        ), path
