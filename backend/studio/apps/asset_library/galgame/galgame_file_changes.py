"""Apply Galgame project original edits only from their settled source receipts."""

from sqlalchemy import delete, select

from app.capabilities.asset_store.models import VisualAsset
from studio.apps.asset_library.deletions import schedule
from studio.apps.asset_library.references.references import (
    protect_pending_removals,
    protect_references,
)
from studio.apps.asset_library.scoped_project_files import check_project_scope
from studio.apps.asset_library.storage.service_models import PreparedAssetPin, ReferenceIntent
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.references import GalgameFileMutation


def command(change):
    return {"galgame_file_mutation": change.galgame_file_mutation.model_dump(mode="json")}


async def original(session, owner, project_id, asset_id):
    row = await session.scalar(
        select(VisualAsset).where(
            VisualAsset.id == asset_id,
            VisualAsset.owner_user_id == owner,
            VisualAsset.galgame_project_id == project_id,
        )
    )
    if row is None:
        raise AssetError("工程素材不存在", code="not_found", status=404)
    return row


async def prepare(session, owner, row, change):
    project_id = change.galgame_file_mutation.project_id
    await check_project_scope(session, "galgame", project_id)
    asset = await original(session, owner, project_id, change.resource_id)
    if asset.revision != change.expected_resource_revision:
        raise AssetError("素材已更新", code="resource_revision_conflict", status=409)
    if change.resource_kind == "file-removal":
        await protect_references(session, [asset.id])
    else:
        await protect_pending_removals(session, [asset.id])
        pending = await session.scalar(
            select(ReferenceIntent.id)
            .where(ReferenceIntent.reference_set_id == row.id, ReferenceIntent.state == "prepared")
            .limit(1)
        )
        if pending is not None:
            raise AssetError("素材正在更新", code="reference_mutations_pending", status=409)
    return asset.id


async def commit(session, owner, row, intent, revision, deleted):
    removing = row.resource_kind == "file-removal"
    if deleted != removing or revision != intent.expected_resource_revision + 1:
        raise AssetError("素材变更回执版本无效", code="invalid_resource_revision", status=422)
    scope = GalgameFileMutation.model_validate(intent.prepared_result["galgame_file_mutation"])
    asset = await original(session, owner, scope.project_id, row.resource_id)
    if asset.revision != intent.expected_resource_revision:
        raise AssetError("素材已更新", code="resource_revision_conflict", status=409)
    if removing:
        await session.execute(
            delete(PreparedAssetPin).where(PreparedAssetPin.intent_id == intent.id)
        )
        await protect_references(session, [asset.id])
        schedule(session, [asset])
        await session.delete(asset)
    else:
        if scope.display_name is not None:
            asset.display_name = scope.display_name
        asset.revision = revision
