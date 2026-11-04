"""Reconstruct exact current and saved Story references from the sealed legacy source."""

from uuid import uuid5

from sqlalchemy import column, func, or_, select, table

from app.apps.galgame_workshop.models import (
    GalgameAssetMetadata,
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameStorySnapshot,
    GalgameWorkshopProject,
)
from app.apps.galgame_workshop.story.document_values import normalize_story_document
from fpl_runtime.galgame_migration import PINS_DATASET, StoryPinBatch, StoryPinPage, StoryPins
from fpl_runtime.project_history_migration import blocked, inventory

from .migration_records import DATASETS

LEGACY_ASSETS = table(
    "visual_assets", column("id"), column("owner_user_id"), column("galgame_project_id")
)


async def inventory_pins(sessions, plan):
    async with sessions() as db:
        invalid_metadata = await db.scalar(
            select(func.count())
            .select_from(GalgameAssetMetadata)
            .outerjoin(LEGACY_ASSETS, LEGACY_ASSETS.c.id == GalgameAssetMetadata.asset_id)
            .outerjoin(
                GalgameWorkshopProject, GalgameWorkshopProject.id == GalgameAssetMetadata.project_id
            )
            .where(
                or_(
                    LEGACY_ASSETS.c.id.is_(None),
                    GalgameWorkshopProject.id.is_(None),
                    LEGACY_ASSETS.c.owner_user_id != GalgameWorkshopProject.owner_user_id,
                    LEGACY_ASSETS.c.galgame_project_id.is_(None),
                    LEGACY_ASSETS.c.galgame_project_id != GalgameAssetMetadata.project_id,
                )
            )
        )
    if invalid_metadata:
        raise blocked("migration_galgame_asset_owner_conflict")
    return await inventory(sessions, plan, DATASETS[1])


def file_ids(document):
    return {asset.file_id for asset in normalize_story_document(document).assets}


async def export_pins(sessions, plan, owner, after):
    async with sessions(info={"owner_user_id": str(owner)}) as db:
        rows = list(
            await db.scalars(
                select(GalgameStoryDocument)
                .join(
                    GalgameWorkshopProject,
                    GalgameWorkshopProject.id == GalgameStoryDocument.project_id,
                )
                .where(
                    GalgameWorkshopProject.owner_user_id == str(owner),
                    GalgameStoryDocument.project_id > (after or ""),
                )
                .order_by(GalgameStoryDocument.project_id)
                .limit(2)
            )
        )
        records = []
        for row in rows[:1]:
            current = file_ids(row.document)
            saved = set(
                await db.scalars(
                    select(GalgameProjectAssetReference.asset_id).where(
                        GalgameProjectAssetReference.project_id == row.project_id
                    )
                )
            )
            if current != saved:
                raise blocked("migration_galgame_reference_index_conflict")
            retained = set(saved)
            for snapshot in await db.scalars(
                select(GalgameStorySnapshot.document).where(
                    GalgameStorySnapshot.project_id == row.project_id
                )
            ):
                retained.update(file_ids(snapshot))
            records.append(
                StoryPins(id=row.project_id, revision=row.revision, asset_ids=sorted(retained))
            )
    batch = StoryPinBatch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=PINS_DATASET,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{PINS_DATASET}/{owner}/{after or ''}"),
        records=tuple(records),
    )
    return StoryPinPage(
        batch=batch, sha256=batch.digest, next_cursor=records[-1].id if len(rows) > 1 else None
    )
