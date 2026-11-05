"""Place a chroma-baked copy next to its original in the project organization."""

from copy import deepcopy

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.runtime.time import utc_now

from .models import VideoEditorTimeline


async def insert_baked_asset_in_organization(
    session: AsyncSession,
    *,
    project_id: str,
    source_asset_id: str,
    output_asset_id: str,
) -> None:
    timeline = await session.get(VideoEditorTimeline, project_id)
    if timeline is None:
        return
    document = deepcopy(timeline.document or {})
    organization = document.get("assetOrganization") or {
        "folders": [],
        "rootAssetIds": [],
    }
    folders = organization.get("folders") or []
    root_asset_ids = list(organization.get("rootAssetIds") or [])
    placed = False

    def insert_after(ids: list[str]) -> list[str]:
        if output_asset_id in ids:
            return ids
        if source_asset_id in ids:
            index = ids.index(source_asset_id) + 1
            return [*ids[:index], output_asset_id, *ids[index:]]
        return [*ids, output_asset_id]

    for folder in folders:
        asset_ids = list(folder.get("assetIds") or [])
        if source_asset_id in asset_ids:
            folder["assetIds"] = insert_after(asset_ids)
            placed = True
            break
    if not placed:
        if source_asset_id not in root_asset_ids:
            root_asset_ids = [*root_asset_ids, source_asset_id]
        organization["rootAssetIds"] = insert_after(root_asset_ids)
    organization["folders"] = folders
    document["assetOrganization"] = organization
    expected = timeline.revision
    result = await session.execute(
        update(VideoEditorTimeline)
        .where(
            VideoEditorTimeline.project_id == project_id,
            VideoEditorTimeline.revision == expected,
        )
        .values(
            document=document,
            revision=expected + 1,
            updated_at=utc_now(),
        )
    )
    if result.rowcount != 1:
        # Organization placement is best-effort; bake output still succeeds.
        return
