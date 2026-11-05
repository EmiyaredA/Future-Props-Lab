"""Maintain the Galgame-owned lookup for current story assets."""

from sqlalchemy import delete, select

from studio.apps.galgame_workshop.storage.models import GalgameProjectAssetReference


async def sync_asset_references(session, project_id: str, file_ids: set[str]) -> None:
    current = (
        (
            await session.execute(
                select(GalgameProjectAssetReference).where(
                    GalgameProjectAssetReference.project_id == project_id
                )
            )
        )
        .scalars()
        .all()
    )
    current_ids = {row.asset_id for row in current}
    removed = current_ids - file_ids
    if removed:
        await session.execute(
            delete(GalgameProjectAssetReference).where(
                GalgameProjectAssetReference.project_id == project_id,
                GalgameProjectAssetReference.asset_id.in_(removed),
            )
        )
    for asset_id in file_ids - current_ids:
        session.add(
            GalgameProjectAssetReference(
                project_id=project_id,
                asset_id=asset_id,
            )
        )
