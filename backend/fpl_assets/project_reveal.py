"""Prepare only an active owned Video project directory for local reveal."""

from sqlalchemy import text

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.storage import AssetStorage

from .scoped_project_files import check_writable


async def prepare_layout(database, settings, owner, project_id):
    storage = AssetStorage(settings)
    root = settings.runtime_path
    folder = storage.project_root("video-editor", project_id, owner_user_id=owner)
    if not folder.resolve().is_relative_to(root) or any(
        value.is_symlink()
        for value in (
            folder,
            *folder.parents,
            folder / "assets",
            folder / "derived",
            folder / "exports",
        )
        if value != root and value.is_relative_to(root)
    ):
        raise AssetError("项目文件夹不存在", code="project_folder_missing", status=409)
    async with database.sessions(info={"owner_user_id": owner}) as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        await check_writable(session, "video", project_id)
        try:
            storage.ensure_project_layout("video-editor", project_id, owner_user_id=owner)
        except OSError:
            raise AssetError(
                "无法创建项目文件夹", code="folder_open_unavailable", status=503
            ) from None
        await session.commit()
