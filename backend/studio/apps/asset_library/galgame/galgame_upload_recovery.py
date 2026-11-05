"""Resolve interrupted Galgame file staging using the owner's durable receipt."""

from sqlalchemy import select

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.service_models import (
    GalgameUploadReceipt,
    GalgameUploadStage,
)


async def settle_stage(session, storage, row):
    identity = row.owner_user_id, row.request_id
    receipt = await session.get(GalgameUploadReceipt, identity)
    if receipt is not None:
        await session.delete(row)
    elif row.state == "open":
        for key in row.storage_keys:
            path = storage.target_path(
                key,
                visual_project_id=None,
                galgame_project_id=row.project_id,
                owner_user_id=row.owner_user_id,
            )
            path.unlink(missing_ok=True)
            scratch = path.parent / ".tmp"
            if scratch.is_dir() and not scratch.is_symlink():
                for item in scratch.glob(f"{key}-*.tmp"):
                    item.unlink(missing_ok=True)
        row.state, row.storage_keys = "aborted", []
    await session.commit()


async def recover_uploads(database, settings):
    storage = AssetStorage(settings)
    async with database.sessions(info={"allow_system_reads": True}) as session:
        keys = list(
            await session.execute(
                select(GalgameUploadStage.owner_user_id, GalgameUploadStage.request_id).where(
                    GalgameUploadStage.state == "open"
                )
            )
        )
    for owner, identity in keys:
        async with database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(GalgameUploadStage, (owner, identity))
            if row is not None:
                await settle_stage(session, storage, row)
