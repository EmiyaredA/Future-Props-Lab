"""Read scoped video originals without a Video Editor database dependency."""

from pathlib import Path

from sqlalchemy import select

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.policy import VIDEO_EDITABLE_EXTENSIONS
from fpl_runtime.video_assets import VideoAsset


async def describe(session, owner, project_id, asset_ids):
    if session.info.get("owner_user_id") != owner:
        raise ValueError("剪辑素材请求缺少匹配的账号上下文")
    rows = (
        await session.scalars(
            select(VisualAsset)
            .where(
                VisualAsset.owner_user_id == owner,
                VisualAsset.video_editor_project_id == project_id,
                VisualAsset.id.in_(asset_ids),
            )
            .order_by(VisualAsset.id)
        )
    ).all()
    if [row.id for row in rows] != asset_ids:
        raise AssetError("剪辑项目素材不存在", code="video_project_asset_missing", status=404)
    return [
        VideoAsset(**{field: getattr(row, field) for field in VideoAsset.model_fields})
        for row in rows
    ]


def record(_project, row):
    return VideoAsset(
        **{field: getattr(row, field) for field in VideoAsset.model_fields}
    ).model_dump(mode="json")


async def files(session, owner, project_id):
    rows = await session.scalars(
        select(VisualAsset)
        .where(
            VisualAsset.owner_user_id == owner, VisualAsset.video_editor_project_id == project_id
        )
        .order_by(VisualAsset.created_at.desc(), VisualAsset.id)
    )
    return [record(project_id, row) for row in rows]


async def available(session, owner):
    rows = await session.scalars(
        select(VisualAsset)
        .where(VisualAsset.owner_user_id == owner, VisualAsset.video_editor_project_id.is_(None))
        .order_by(VisualAsset.updated_at.desc())
        .limit(500)
    )
    return [
        {
            "id": row.id,
            "displayName": row.display_name,
            "mediaKind": row.media_kind,
            "mimeType": row.mime_type,
            "sourceApplication": (
                "galgame-workshop"
                if row.galgame_project_id
                else "visual-workshop"
                if row.project_id
                else "file-library"
            ),
        }
        for row in rows
        if Path(row.original_filename).suffix.lower() in VIDEO_EDITABLE_EXTENSIONS
    ]


async def original_record(session, owner, project_id, asset_id):
    return await session.scalar(
        select(VisualAsset).where(
            VisualAsset.owner_user_id == owner,
            VisualAsset.video_editor_project_id == project_id,
            VisualAsset.id == asset_id,
        )
    )
