"""Prepare only the exact account-owned project directory for local reveal."""

from sqlalchemy import text

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.reveal import APPLICATION_SERVICES

from .scoped_project_files import check_project_scope


async def prepare_layout(database, settings, owner, application, project_id):
    storage = AssetStorage(settings)
    root = settings.runtime_path
    folder = root / "accounts" / owner / "applications" / application / "projects" / project_id
    subfolders = (
        ("assets", "generated")
        if application == "visual-workshop"
        else ("assets", "derived", "exports")
    )
    ancestors = [item for item in folder.parents if item.is_relative_to(root) and item != root]
    if any(
        item.is_symlink() for item in (folder, *ancestors, *(folder / name for name in subfolders))
    ):
        raise AssetError("项目文件夹不存在", code="project_folder_missing", status=409)
    async with database.sessions(info={"owner_user_id": owner}) as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        await check_project_scope(session, APPLICATION_SERVICES[application], project_id)
        try:
            storage.ensure_project_layout(application, project_id, owner_user_id=owner)
        except (OSError, ValueError):
            raise AssetError(
                "无法创建项目文件夹", code="folder_open_unavailable", status=503
            ) from None
        await session.commit()
