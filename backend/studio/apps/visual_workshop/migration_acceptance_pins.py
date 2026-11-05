"""Rebuild the project acceptance evidence retention from sealed legacy records."""

from uuid import uuid5

from sqlalchemy import select

from studio.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRun,
    AcceptanceStandard,
    AcceptanceStandardVersion,
)
from studio.apps.visual_workshop.storage.migration_records import DATASETS
from studio.apps.visual_workshop.storage.models import VisualWorkshopProject
from studio.contracts.visual_workshop.visual_migration import (
    ACCEPTANCE_PINS_DATASET,
    AcceptancePinBatch,
    AcceptancePinPage,
    CanvasPins,
)
from studio.runtime.database.project_history_migration import blocked, inventory


async def inventory_acceptance_pins(sessions, plan):
    return await inventory(sessions, plan, DATASETS[0])


async def project_pins(session, project):
    runs = (
        await session.execute(
            select(AcceptanceRun.id, AcceptanceRun.previous_run_id).where(
                AcceptanceRun.project_id == project.id,
                AcceptanceRun.owner_user_id == project.owner_user_id,
            )
        )
    ).all()
    known = {identity for identity, _ in runs}
    if any(previous is not None and previous not in known for _, previous in runs):
        raise blocked("migration_visual_acceptance_previous_run_missing")
    standard = await session.get(AcceptanceStandard, project.id)
    if standard is not None and standard.published_version:
        version = await session.scalar(
            select(AcceptanceStandardVersion.id).where(
                AcceptanceStandardVersion.project_id == project.id,
                AcceptanceStandardVersion.owner_user_id == project.owner_user_id,
                AcceptanceStandardVersion.version == standard.published_version,
            )
        )
        if version is None:
            raise blocked("migration_visual_acceptance_published_version_missing")
    asset_ids = list(
        await session.scalars(
            select(AcceptanceAssetReference.asset_id)
            .where(AcceptanceAssetReference.project_id == project.id)
            .distinct()
            .order_by(AcceptanceAssetReference.asset_id)
        )
    )
    if standard is not None:
        asset_ids.extend(
            identity
            for criterion in standard.draft.get("criteria", [])
            for identity in criterion.get("reference_asset_ids", [])
        )
    return CanvasPins(id=project.id, revision=0, asset_ids=sorted(set(asset_ids)))


async def export_acceptance_pins(sessions, plan, owner, after):
    async with sessions(info={"owner_user_id": str(owner)}) as session:
        projects = list(
            await session.scalars(
                select(VisualWorkshopProject)
                .where(
                    VisualWorkshopProject.owner_user_id == str(owner),
                    VisualWorkshopProject.id > (after or ""),
                )
                .order_by(VisualWorkshopProject.id)
                .limit(2)
            )
        )
        records = tuple([await project_pins(session, project) for project in projects[:1]])
    batch = AcceptancePinBatch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=ACCEPTANCE_PINS_DATASET,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{ACCEPTANCE_PINS_DATASET}/{owner}/{after or ''}"),
        records=records,
    )
    return AcceptancePinPage(
        batch=batch, sha256=batch.digest, next_cursor=records[-1].id if len(projects) > 1 else None
    )
