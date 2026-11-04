"""Identify editable originals in a portable Video project snapshot."""

from sqlalchemy import select

from .models import VideoEditorTask


def timeline_asset_ids(document: dict) -> set[str]:
    ids = {
        str(clip[key])
        for track in document.get("tracks", [])
        if isinstance(track, dict)
        for clip in track.get("clips", [])
        if isinstance(clip, dict)
        for key in ("assetId", "fontAssetId")
        if clip.get(key)
    }
    organization = document.get("assetOrganization") or {}
    ids.update(str(asset_id) for asset_id in organization.get("rootAssetIds") or [])
    for folder in organization.get("folders") or []:
        ids.update(str(asset_id) for asset_id in folder.get("assetIds") or [])
    return ids


async def output_asset_ids(session, owner, project_id):
    output_ids = set(
        (
            await session.execute(
                select(VideoEditorTask.output_asset_id).where(
                    VideoEditorTask.project_id == project_id,
                    VideoEditorTask.output_asset_id.is_not(None),
                    VideoEditorTask.kind.in_(("render", "segment_export", "asset_bake")),
                )
            )
        ).scalars()
    )
    segment_details = await session.scalars(
        select(VideoEditorTask.result_detail).where(
            VideoEditorTask.project_id == project_id,
            VideoEditorTask.owner_user_id == owner,
            VideoEditorTask.kind == "segment_export",
            VideoEditorTask.status == "completed",
        )
    )
    output_ids.update(
        item["assetId"]
        for detail in segment_details
        for item in (detail or {}).get("segments", [])
        if item.get("status") == "completed" and item.get("assetId")
    )
    return output_ids
