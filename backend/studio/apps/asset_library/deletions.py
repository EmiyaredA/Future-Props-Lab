"""Committed file removals survive process failure; no recursive directory deletion."""

import asyncio
from dataclasses import dataclass

from sqlalchemy import select

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.service_models import AssetDeletion


@dataclass(frozen=True)
class RemovedAsset:
    owner_user_id: str
    storage_key: str
    storage_version: int
    project_id: str | None
    galgame_project_id: str | None
    video_editor_project_id: str | None
    motion_compositor_project_id: str | None


def schedule(session, rows):
    for row in rows:
        snapshot = {key: getattr(row, key) for key in RemovedAsset.__dataclass_fields__}
        session.add(
            AssetDeletion(
                owner_user_id=row.owner_user_id,
                asset_id=row.id,
                asset_snapshot=snapshot,
            )
        )


class FileCleanup:
    def __init__(self, database, settings):
        self.database, self.settings = database, settings
        self.lock = asyncio.Lock()

    async def run_once(self, limit=100):
        async with self.lock:
            async with self.database.sessions(info={"allow_system_reads": True}) as session:
                pending = list(
                    (
                        await session.scalars(
                            select(AssetDeletion)
                            .where(
                                AssetDeletion.status == "queued",
                            )
                            .order_by(AssetDeletion.created_at)
                            .limit(limit)
                        )
                    ).all()
                )
            completed = 0
            storage = AssetStorage(self.settings)
            root = self.settings.runtime_path.resolve()
            for item in pending:
                error = ""
                try:
                    asset = RemovedAsset(**item.asset_snapshot)
                    if asset.owner_user_id != item.owner_user_id:
                        raise ValueError("stored ownership mismatch")
                    path = storage.path_for(asset)
                    account = root / "accounts" / item.owner_user_id
                    if not path.resolve().is_relative_to(account) or path.is_symlink():
                        raise ValueError("stored file escaped account root")
                    await asyncio.to_thread(path.unlink, missing_ok=True)
                except (OSError, ValueError, TypeError):
                    error = "file_cleanup_failed"
                async with self.database.sessions() as session:
                    session.info["owner_user_id"] = item.owner_user_id
                    current = await session.get(AssetDeletion, item.id)
                    if current is not None and current.status == "queued":
                        current.error_code = error
                        if not error:
                            current.status = "completed"
                            completed += 1
                        await session.commit()
            return completed
