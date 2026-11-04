"""Prepare only the exact account-owned project directory for local reveal."""

from sqlalchemy import select, text

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.storage import AssetStorage
from fpl_runtime.project_reveal import APPLICATION_SERVICES

from .models import AssetReferenceSet
from .scoped_project_files import check_writable

DOCUMENTS = {"visual": "canvas", "galgame": "story"}


async def check_project_scope(session, service, project_id):
    if service == "video":
        await check_writable(session, service, project_id)
        return
    projection = await session.scalar(
        select(AssetReferenceSet).where(
            AssetReferenceSet.service_id == service,
            AssetReferenceSet.resource_kind == DOCUMENTS[service],
            AssetReferenceSet.resource_id == project_id,
        )
    )
    if projection is None:
        raise AssetError("项目文件范围尚未核验", code="project_scope_unverified", status=503)
    if projection.deleted:
        raise AssetError("项目已删除", code="not_found", status=404)


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
