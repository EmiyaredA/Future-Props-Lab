"""Materialize one account's exact Galgame project file snapshot."""

from anyio import to_thread
from sqlalchemy import or_, select

from app.capabilities.asset_store.asset_scope import is_library_asset
from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.media_metadata import inspect_media_file
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from fpl_runtime.galgame_assets import GalgameAssetFile, MediaInspection

from .models import AssetReferencePin, AssetReferenceSet, PreparedAssetPin, ReferenceIntent
from .scoped_project_files import check_project_scope


def _retained_story_files(owner, project_id):
    projection = select(AssetReferenceSet.id).where(
        AssetReferenceSet.owner_user_id == owner,
        AssetReferenceSet.service_id == "galgame",
        AssetReferenceSet.resource_kind == "story",
        AssetReferenceSet.resource_id == project_id,
        AssetReferenceSet.deleted.is_(False),
    )
    committed = select(AssetReferencePin.asset_id).where(
        AssetReferencePin.reference_set_id.in_(projection)
    )
    pending = (
        select(PreparedAssetPin.asset_id)
        .join(ReferenceIntent, ReferenceIntent.id == PreparedAssetPin.intent_id)
        .where(
            ReferenceIntent.reference_set_id.in_(projection),
            ReferenceIntent.state == "prepared",
        )
    )
    return committed.union(pending)


async def files(session, settings, project_id, query):
    await check_project_scope(session, "galgame", project_id)
    owner = session.info["owner_user_id"]
    statement = select(VisualAsset).where(VisualAsset.owner_user_id == owner)
    owned = VisualAsset.galgame_project_id == project_id
    library = (
        VisualAsset.project_id.is_(None)
        & VisualAsset.galgame_project_id.is_(None)
        & VisualAsset.video_editor_project_id.is_(None)
        & VisualAsset.motion_compositor_project_id.is_(None)
    )
    scope = owned
    if query.replacement:
        scope = or_(owned, library)
    elif query.asset_ids:
        retained = _retained_story_files(owner, project_id)
        scope = or_(
            owned,
            VisualAsset.id.in_(query.asset_ids) & VisualAsset.id.in_(retained) & library,
        )
    statement = statement.where(scope)
    if query.project_file_id is not None:
        statement = statement.where(VisualAsset.id == query.project_file_id)
    if query.search:
        statement = statement.where(VisualAsset.display_name.ilike(f"%{query.search}%"))
    if query.newest_first:
        statement = statement.order_by(VisualAsset.updated_at.desc(), VisualAsset.created_at.desc())
    else:
        statement = statement.order_by(owned.desc(), VisualAsset.created_at, VisualAsset.id)
    storage = AssetStorage(settings)
    result = []
    for row in await session.scalars(statement):
        path = storage.path_for(row)
        inspection = None
        exists = path.is_file() and not path.is_symlink()
        if query.scan and exists:
            try:
                sha256, width, height, duration = await to_thread.run_sync(
                    inspect_media_file, path, row.media_kind
                )
            except FileNotFoundError:
                exists = False
            else:
                inspection = MediaInspection(
                    sha256=sha256, width=width, height=height, duration_ms=duration
                )
        result.append(
            GalgameAssetFile(
                **{
                    name: getattr(row, name)
                    for name in GalgameAssetFile.model_fields
                    if name not in {"exists", "inspection"}
                },
                exists=exists,
                inspection=inspection,
            )
        )
    return result


async def export_file(session, settings, project_id, asset_id):
    await check_project_scope(session, "galgame", project_id)
    row = await session.scalar(
        select(VisualAsset).where(
            VisualAsset.id == asset_id,
            VisualAsset.galgame_project_id == project_id,
            VisualAsset.media_kind == "video",
        )
    )
    if row is None:
        raise AssetError("导出视频已被删除", code="not_found", status=404)
    path = AssetStorage(settings).path_for(row)
    if path.is_symlink() or not path.is_file():
        raise AssetError("导出视频文件不存在", code="not_found", status=404)
    return row, path


async def snapshot_originals(session, settings, project_id, requested):
    await check_project_scope(session, "galgame", project_id)
    owner = session.info["owner_user_id"]
    ids = {item.id for item in requested}
    rows = list(
        await session.scalars(
            select(VisualAsset)
            .where(VisualAsset.owner_user_id == owner, VisualAsset.id.in_(ids))
            .order_by(VisualAsset.id)
        )
    )
    if [(row.id, row.revision) for row in rows] != [(file.id, file.revision) for file in requested]:
        raise AssetError("Galgame 快照原件已变化或缺失", code="snapshot_source_changed", status=409)
    retained = set(
        await session.scalars(_retained_story_files(owner, project_id).subquery().select())
    )
    for row in rows:
        if row.galgame_project_id != project_id and (
            row.id not in retained or not is_library_asset(row)
        ):
            raise AssetError("Galgame 快照原件不属于当前项目", code="not_found", status=404)
    storage = AssetStorage(settings)
    originals = []
    for row in rows:
        path = storage.path_for(row)
        if path.is_symlink() or not path.is_file() or path.stat().st_size != row.byte_size:
            raise AssetError(
                "Galgame 快照原件已变化或缺失", code="snapshot_source_changed", status=409
            )
        originals.append((path, row.byte_size))
    return originals
