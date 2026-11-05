"""Read exact media retained by a single Visual node acceptance run."""

from sqlalchemy import select

from app.capabilities.asset_store.errors import AssetError
from studio.apps.asset_library.scoped_project_files import check_project_scope
from studio.apps.asset_library.storage.service_models import AssetReferencePin, AssetReferenceSet
from studio.apps.asset_library.visual.visual_snapshot_files import originals, scoped_assets
from studio.contracts.asset_library.descriptions import LibraryAssetDescription
from studio.contracts.visual_workshop.visual_samples import evidence_resource


async def describe_review_media(session, project, run, identities):
    await check_project_scope(session, "visual", project)
    pinned = set(
        await session.scalars(
            select(AssetReferencePin.asset_id)
            .join(AssetReferenceSet, AssetReferenceSet.id == AssetReferencePin.reference_set_id)
            .where(
                AssetReferenceSet.owner_user_id == session.info["owner_user_id"],
                AssetReferenceSet.service_id == "visual",
                AssetReferenceSet.resource_kind == "acceptance",
                AssetReferenceSet.resource_id == evidence_resource(run),
                AssetReferenceSet.scope_project_id == project,
                AssetReferenceSet.deleted.is_(False),
                AssetReferencePin.asset_id.in_(identities),
            )
        )
    )
    if pinned != set(identities):
        raise AssetError("验收素材不存在", code="not_found", status=404)
    rows = await scoped_assets(session, project, identities, include_private=False)
    if len(rows) != len(identities) or any(
        row.media_kind not in {"image", "video"} for row, _ in rows
    ):
        raise AssetError("验收素材不存在", code="not_found", status=404)
    return [LibraryAssetDescription.model_validate(row, from_attributes=True) for row, _ in rows]


async def review_originals(session, settings, plan):
    current = await describe_review_media(
        session, plan.project_id, plan.run_id, [item.id for item in plan.files]
    )
    if current != plan.files:
        raise AssetError("验收原件版本已变化", code="source_changed", status=409)
    return await originals(session, settings, plan.project_id, plan.files)
