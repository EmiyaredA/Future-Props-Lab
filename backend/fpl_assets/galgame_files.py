"""Materialize one account's exact Galgame project file snapshot."""

from sqlalchemy import or_, select

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from fpl_runtime.galgame_assets import GalgameAssetFile

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
        result.append(
            GalgameAssetFile(
                **{
                    name: getattr(row, name)
                    for name in GalgameAssetFile.model_fields
                    if name != "exists"
                },
                exists=storage.path_for(row).is_file(),
            )
        )
    return result
