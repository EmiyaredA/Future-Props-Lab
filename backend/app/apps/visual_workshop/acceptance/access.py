from sqlalchemy import select, update

from app.apps.visual_workshop.acceptance.models import (
    AcceptanceStandard,
)
from app.capabilities.asset_store.models import VisualAsset, VisualProjectAssetReference
from app.runtime.revisions import RevisionConflictError

from .project_access import AcceptanceError


async def asset(session, owner_user_id, project_id, asset_id):
    row = await session.scalar(
        select(VisualAsset).where(
            VisualAsset.id == asset_id, VisualAsset.owner_user_id == owner_user_id
        )
    )
    ref = await session.scalar(
        select(VisualProjectAssetReference.id).where(
            VisualProjectAssetReference.project_id == project_id,
            VisualProjectAssetReference.owner_user_id == owner_user_id,
            VisualProjectAssetReference.asset_id == asset_id,
        )
    )
    if row is None or (row.project_id != project_id and not ref):
        raise AcceptanceError("参考素材不存在或不属于项目", "not_found", 404)
    return row


async def cas(session, row, expected, current):
    # Take the SQLite writer lock before re-reading the revision; a stale client must
    # never overwrite either a worker result or another reviewer's decision.
    cls = type(row)
    key = cls.project_id == row.project_id if cls is AcceptanceStandard else cls.id == row.id
    result = await session.execute(
        update(cls)
        .where(key, cls.revision == expected)
        .values(revision=expected + 1)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        await session.rollback()
        snapshot = await current()
        raise RevisionConflictError(expected, snapshot.revision, snapshot.model_dump(mode="json"))
    await session.refresh(row)
