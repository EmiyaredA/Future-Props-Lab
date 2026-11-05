"""Resolve original files and the project folder layout for portable Visual snapshots."""

from sqlalchemy import and_, or_, select, text

from studio.apps.asset_library.scoped_project_files import check_project_scope
from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset, VisualAssetFolder
from studio.apps.asset_library.storage.service_models import (
    AssetReferencePin,
    AssetReferenceSet,
    VisualProjectFileLink,
)
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.visual_workshop.visual_snapshot import (
    SnapshotAsset,
    SnapshotFiles,
    SnapshotFolder,
)


async def scoped_assets(session, project, identities, *, include_private, include_pinned=True):
    owner = session.info["owner_user_id"]
    link = VisualProjectFileLink
    placement = and_(
        link.asset_id == VisualAsset.id,
        link.owner_user_id == owner,
        link.project_id == project,
    )
    pinned = (
        select(AssetReferencePin.asset_id)
        .join(AssetReferenceSet, AssetReferenceSet.id == AssetReferencePin.reference_set_id)
        .where(
            AssetReferenceSet.owner_user_id == owner,
            AssetReferenceSet.service_id == "visual",
            AssetReferenceSet.resource_kind.in_(("canvas", "acceptance")),
            or_(
                AssetReferenceSet.resource_id == project,
                and_(
                    AssetReferenceSet.resource_kind == "acceptance",
                    AssetReferenceSet.scope_project_id == project,
                ),
            ),
            AssetReferenceSet.deleted.is_(False),
        )
    )
    private = VisualAsset.project_id == project
    library_placement = or_(link.id.is_not(None), VisualAsset.id.in_(pinned))
    library = and_(
        VisualAsset.project_id.is_(None),
        VisualAsset.galgame_project_id.is_(None),
        VisualAsset.video_editor_project_id.is_(None),
        VisualAsset.motion_compositor_project_id.is_(None),
        VisualAsset.id.in_(identities),
        library_placement if include_pinned else link.id.is_not(None),
    )
    if not include_private:
        private = and_(private, VisualAsset.id.in_(identities))
    return (
        await session.execute(
            select(VisualAsset, link)
            .outerjoin(link, placement)
            .where(VisualAsset.owner_user_id == owner, or_(private, library))
            .order_by(VisualAsset.id)
        )
    ).all()


async def metadata(session, settings, project, query):
    await session.execute(text("BEGIN"))
    await check_project_scope(session, "visual", project)
    requested, excluded = set(query.asset_ids), set(query.excluded_generated)
    rows = [
        (row, placement)
        for row, placement in await scoped_assets(session, project, requested, include_private=True)
        if row.id in requested or row.id not in excluded
    ]
    if requested - {row.id for row, _ in rows}:
        raise AssetError("项目引用的素材不存在", code="snapshot_source_missing", status=409)
    maximum = settings.fpl_project_snapshot_max_bytes
    count = settings.fpl_project_snapshot_max_files
    if len(rows) + 2 > count:
        raise AssetError("项目快照文件数量超过限制", code="snapshot_too_many_files", status=413)
    if sum(row.byte_size for row, _ in rows) > maximum:
        raise AssetError("项目快照超过大小限制", code="snapshot_too_large", status=413)
    folders = list(
        await session.scalars(
            select(VisualAssetFolder)
            .where(
                VisualAssetFolder.project_id == project,
                VisualAssetFolder.owner_user_id == session.info["owner_user_id"],
            )
            .order_by(VisualAssetFolder.id)
        )
    )
    return SnapshotFiles(
        assets=[
            SnapshotAsset(
                id=row.id,
                revision=row.revision,
                original_filename=row.original_filename,
                display_name=placement.display_name if placement is not None else row.display_name,
                folder_id=(
                    row.folder_id
                    if row.project_id == project
                    else placement.folder_id
                    if placement is not None
                    else None
                ),
                mime_type=row.mime_type,
                media_kind=row.media_kind,
                byte_size=row.byte_size,
            )
            for row, placement in rows
        ],
        folders=[
            SnapshotFolder(id=row.id, parent_id=row.parent_id, name=row.name) for row in folders
        ],
        max_bytes=maximum,
        max_files=count,
    )


async def originals(session, settings, project, files, *, media_kind=None):
    await check_project_scope(session, "visual", project)
    identities = {item.id for item in files}
    scoped = {
        row.id: row
        for row, _placement in await scoped_assets(
            session, project, identities, include_private=False
        )
    }
    storage = AssetStorage(settings)
    result = []
    for item in files:
        row = scoped.get(item.id)
        if (
            row is None
            or row.revision != item.revision
            or (media_kind is not None and row.media_kind != media_kind)
        ):
            raise AssetError(
                "项目素材在导出过程中已变化", code="snapshot_source_changed", status=409
            )
        path = storage.path_for(row)
        try:
            intact = (
                not path.is_symlink() and path.is_file() and path.stat().st_size == row.byte_size
            )
        except FileNotFoundError:
            intact = False
        if not intact:
            raise AssetError("项目素材原件不完整", code="snapshot_source_missing", status=409)
        result.append((path, row.byte_size))
    if sum(size for _, size in result) > settings.fpl_project_snapshot_max_bytes:
        raise AssetError("项目快照超过大小限制", code="snapshot_too_large", status=413)
    return result
