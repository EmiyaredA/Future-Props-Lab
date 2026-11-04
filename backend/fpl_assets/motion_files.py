"""Resolve only the requested account and project file metadata."""

from pathlib import Path

from sqlalchemy import select

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from fpl_runtime.motion_assets import MOTION_EXTENSIONS, SOURCE, MotionAsset


async def describe(session, owner, project_id, asset_ids):
    if session.info.get("owner_user_id") != owner:
        raise ValueError("特效素材请求缺少匹配的账号上下文")
    rows = list(
        await session.scalars(
            select(VisualAsset)
            .where(
                VisualAsset.owner_user_id == owner,
                VisualAsset.motion_compositor_project_id == project_id,
                VisualAsset.id.in_(asset_ids),
            )
            .order_by(VisualAsset.id)
        )
    )
    if [row.id for row in rows] != asset_ids:
        raise AssetError("特效项目素材不存在", code="motion_project_asset_missing", status=404)
    return [
        MotionAsset(**{field: getattr(row, field) for field in MotionAsset.model_fields})
        for row in rows
    ]


def source_application(row):
    return next(
        (
            application
            for key, application in (
                ("project_id", "visual-workshop"),
                ("video_editor_project_id", "video-editor"),
                ("galgame_project_id", "galgame-workshop"),
                ("motion_compositor_project_id", "motion-compositor"),
            )
            if getattr(row, key) is not None
        ),
        "file-library",
    )


async def import_sources(session, owner):
    records = list(
        await session.scalars(
            select(VisualAsset)
            .where(
                VisualAsset.owner_user_id == owner,
                VisualAsset.media_kind.in_(("image", "video")),
            )
            .order_by(VisualAsset.updated_at.desc())
            .limit(500)
        )
    )
    return [
        {
            "id": row.id,
            "displayName": row.display_name,
            "mediaKind": row.media_kind,
            "sourceApplication": source_application(row),
        }
        for row in records
        if Path(row.original_filename).suffix.lower() in MOTION_EXTENSIONS
    ]


def project_query(owner, project_id):
    return select(VisualAsset).where(
        VisualAsset.owner_user_id == owner,
        VisualAsset.motion_compositor_project_id == project_id,
    )


def file_record(project_id, row):
    return {
        "id": row.id,
        "displayName": row.display_name,
        "mediaKind": row.media_kind,
        "mimeType": row.mime_type,
        "url": f"{SOURCE}/projects/{project_id}/assets/{row.id}/file",
    }


async def files(session, owner, project_id):
    records = list(
        await session.scalars(
            project_query(owner, project_id).order_by(VisualAsset.created_at.desc())
        )
    )
    return [file_record(project_id, row) for row in records]


async def original(session, settings, owner, project_id, asset_id):
    row = await session.scalar(project_query(owner, project_id).where(VisualAsset.id == asset_id))
    if row is None:
        raise AssetError("素材不存在", code="not_found", status=404)
    path = AssetStorage(settings).path_for(row)
    if path.is_symlink() or not path.is_file():
        raise AssetError("素材不存在", code="not_found", status=404)
    return path, row.mime_type
