"""Restore verified Presentation reference sets after the account library transfer."""

from functools import partial
from uuid import uuid5

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.capabilities.asset_store.models import VisualAsset
from app.runtime.ids import new_id
from fpl_runtime.migration_apps import mount_dataset
from fpl_runtime.migration_receipts import batch_receipt, has_receipt, record_receipt
from fpl_runtime.presentation_migration import (
    ID,
    REFERENCE_DATASETS,
    Projection,
    ProjectionBatch,
    ProjectionPage,
)

from .migration_blobs import DATASET as ASSET_BLOBS
from .migration_models import AssetImportReceipt
from .models import AssetReferencePin, AssetReferenceSet

SERVICE = "presentation"


async def inventory(sessions, plan, kind):
    async with sessions(info={"allow_system_reads": True}) as db:
        counts = dict(
            (
                await db.execute(
                    select(AssetReferenceSet.owner_user_id, func.count())
                    .where(
                        AssetReferenceSet.service_id == SERVICE,
                        AssetReferenceSet.resource_kind == kind,
                    )
                    .group_by(AssetReferenceSet.owner_user_id)
                )
            ).all()
        )
    if set(counts) - {str(owner) for owner in plan.owner_ids}:
        raise HTTPException(409, {"code": "migration_owner_unassigned"})
    return {"record_count": sum(counts.values())}


async def page(sessions, plan, dataset, kind, owner, after):
    async with sessions(info={"owner_user_id": str(owner)}) as db:
        rows = list(
            await db.scalars(
                select(AssetReferenceSet)
                .where(
                    AssetReferenceSet.service_id == SERVICE,
                    AssetReferenceSet.resource_kind == kind,
                    AssetReferenceSet.resource_id > (after or ""),
                )
                .order_by(AssetReferenceSet.resource_id)
                .limit(2)
            )
        )
        records = []
        for row in rows[:1]:
            if row.deleted or row.resource_revision < 0:
                raise HTTPException(409, {"code": "migration_reference_unsettled"})
            assets = list(
                await db.scalars(
                    select(AssetReferencePin.asset_id)
                    .where(AssetReferencePin.reference_set_id == row.id)
                    .order_by(AssetReferencePin.asset_id)
                )
            )
            records.append(
                Projection(id=row.resource_id, revision=row.resource_revision, asset_ids=assets)
            )
    batch = ProjectionBatch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=dataset,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{dataset}/{owner}/{after or ''}"),
        records=tuple(records),
    )
    return ProjectionPage(
        batch=batch, sha256=batch.digest, next_cursor=records[-1].id if len(rows) > 1 else None
    )


async def ingest(sessions, kind, batch):
    if REFERENCE_DATASETS[batch.dataset] != kind:
        raise HTTPException(409, {"code": "migration_reference_dataset_mismatch"})
    owner = str(batch.owner_id)
    receipt = batch_receipt(batch)
    async with sessions(info={"owner_user_id": owner}) as db:
        await db.execute(text("BEGIN IMMEDIATE"))
        if await has_receipt(db, AssetImportReceipt, receipt):
            return receipt
        for record in batch.records:
            present = set(
                await db.scalars(
                    select(VisualAsset.id).where(
                        VisualAsset.id.in_(record.asset_ids),
                        VisualAsset.project_id.is_(None),
                        VisualAsset.galgame_project_id.is_(None),
                        VisualAsset.video_editor_project_id.is_(None),
                        VisualAsset.motion_compositor_project_id.is_(None),
                        VisualAsset.media_kind.in_(("image", "audio", "video")),
                    )
                )
            )
            if set(record.asset_ids) != present:
                raise HTTPException(409, {"code": "migration_reference_asset_unavailable"})
            expected_files = {
                str(uuid5(batch.run_id, f"{ASSET_BLOBS}/{owner}/{asset}")) for asset in present
            }
            imported_files = set(
                await db.scalars(
                    select(AssetImportReceipt.batch_id).where(
                        AssetImportReceipt.run_id == str(batch.run_id),
                        AssetImportReceipt.dataset == ASSET_BLOBS,
                        AssetImportReceipt.batch_id.in_(expected_files),
                    )
                )
            )
            if imported_files != expected_files:
                raise HTTPException(409, {"code": "migration_reference_file_unverified"})
            identity = new_id()
            db.add(
                AssetReferenceSet(
                    id=identity,
                    owner_user_id=owner,
                    service_id=SERVICE,
                    resource_kind=kind,
                    resource_id=record.id,
                    resource_revision=record.revision,
                )
            )
            try:
                await db.flush()
            except IntegrityError:
                raise HTTPException(409, {"code": "migration_reference_overlap"}) from None
            db.add_all(
                AssetReferencePin(reference_set_id=identity, asset_id=asset, owner_user_id=owner)
                for asset in record.asset_ids
            )
        record_receipt(db, AssetImportReceipt, receipt)
        await db.commit()
    return receipt


def mount_presentation_references(app, plan, sessions):
    for dataset, kind in REFERENCE_DATASETS.items():
        mount_dataset(
            app,
            prefix="/v1/migration/presentation/" + dataset.split(".")[1],
            plan=plan,
            cursor_pattern=ID,
            batch_model=ProjectionBatch,
            page_model=ProjectionPage,
            inventory=partial(inventory, sessions, plan, kind),
            page=partial(page, sessions, plan, dataset, kind),
            ingest=partial(ingest, sessions, kind),
        )
