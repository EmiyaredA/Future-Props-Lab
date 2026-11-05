"""Restore verified project pins after the owner file transfer."""

from functools import partial
from uuid import uuid5

from fastapi import HTTPException
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError

from app.capabilities.asset_store.models import VisualAsset
from studio.apps.asset_library.storage.service_models import AssetReferencePin, AssetReferenceSet
from studio.contracts.galgame_workshop.galgame_migration import (
    PINS_DATASET,
    PINS_PATH,
    StoryPinBatch,
    StoryPinPage,
    StoryPins,
)
from studio.contracts.presentation_workshop.presentation_migration import (
    ID,
    REFERENCE_DATASETS,
    Projection,
    ProjectionBatch,
    ProjectionPage,
)
from studio.contracts.thought_workshop.migration import (
    PIN_CURSOR,
    PIN_KINDS,
    ThoughtPinBatch,
    ThoughtPinPage,
    ThoughtPins,
    pin_path,
)
from studio.contracts.visual_workshop.visual_migration import (
    ACCEPTANCE_PINS_DATASET,
    ACCEPTANCE_PINS_PATH,
    CANVAS_PINS_DATASET,
    CANVAS_PINS_PATH,
    CONVERSATION_PINS_DATASET,
    CONVERSATION_PINS_PATH,
    AcceptancePinBatch,
    AcceptancePinPage,
    CanvasPinBatch,
    CanvasPinPage,
    CanvasPins,
    ConversationPinBatch,
    ConversationPinPage,
    ConversationPins,
)
from studio.runtime.database.migration_apps import mount_dataset
from studio.runtime.database.migration_receipts import batch_receipt, has_receipt, record_receipt
from studio.runtime.database.project_history_migration import CURSOR
from studio.runtime.ids import new_id

from .migration_blobs import DATASET as ASSET_BLOBS
from .migration_models import AssetImportReceipt

LIBRARY = (
    VisualAsset.project_id.is_(None)
    & VisualAsset.galgame_project_id.is_(None)
    & VisualAsset.video_editor_project_id.is_(None)
    & VisualAsset.motion_compositor_project_id.is_(None)
)

PROJECT_SCOPES = {
    "galgame": VisualAsset.galgame_project_id,
    "visual": VisualAsset.project_id,
}


async def inventory(sessions, plan, service, kind):
    async with sessions(info={"allow_system_reads": True}) as db:
        counts = dict(
            (
                await db.execute(
                    select(AssetReferenceSet.owner_user_id, func.count())
                    .where(
                        AssetReferenceSet.service_id == service,
                        AssetReferenceSet.resource_kind == kind,
                    )
                    .group_by(AssetReferenceSet.owner_user_id)
                )
            ).all()
        )
    if set(counts) - {str(owner) for owner in plan.owner_ids}:
        raise HTTPException(409, {"code": "migration_owner_unassigned"})
    return {"record_count": sum(counts.values())}


async def page(
    sessions, plan, dataset, service, kind, record_type, batch_type, page_type, owner, after
):
    async with sessions(info={"owner_user_id": str(owner)}) as db:
        rows = list(
            await db.scalars(
                select(AssetReferenceSet)
                .where(
                    AssetReferenceSet.service_id == service,
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
            scope = {}
            if kind == "conversation":
                if row.scope_project_id is None:
                    raise HTTPException(409, {"code": "migration_reference_project_missing"})
                scope["project_id"] = row.scope_project_id
            records.append(
                record_type(
                    id=row.resource_id, revision=row.resource_revision, asset_ids=assets, **scope
                )
            )
    batch = batch_type(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=dataset,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{dataset}/{owner}/{after or ''}"),
        records=tuple(records),
    )
    return page_type(
        batch=batch, sha256=batch.digest, next_cursor=records[-1].id if len(rows) > 1 else None
    )


async def ingest(sessions, dataset, service, kind, batch):
    if batch.dataset != dataset:
        raise HTTPException(409, {"code": "migration_reference_dataset_mismatch"})
    owner = str(batch.owner_id)
    receipt = batch_receipt(batch)
    async with sessions(info={"owner_user_id": owner}) as db:
        await db.execute(text("BEGIN IMMEDIATE"))
        if await has_receipt(db, AssetImportReceipt, receipt):
            return receipt
        for record in batch.records:
            scope = PROJECT_SCOPES.get(service)
            project_id = record.id
            media = ("image", "audio", "video")
            if kind == "conversation":
                project_id = record.project_id
                media = (*media, "document")
            if service == "thought":
                media = (
                    ("image",)
                    if kind in {"knowledge-base", "publication"}
                    else (*media, "document")
                )
            if kind in {"conversation", "acceptance"}:
                parent = await db.scalar(
                    select(AssetReferenceSet.id).where(
                        AssetReferenceSet.owner_user_id == owner,
                        AssetReferenceSet.service_id == service,
                        AssetReferenceSet.resource_kind == "canvas",
                        AssetReferenceSet.resource_id == project_id,
                        AssetReferenceSet.deleted.is_(False),
                    )
                )
                if parent is None:
                    raise HTTPException(409, {"code": "migration_reference_project_missing"})
            allowed = LIBRARY if scope is None else or_(LIBRARY, scope == project_id)
            present = set(
                await db.scalars(
                    select(VisualAsset.id).where(
                        VisualAsset.id.in_(record.asset_ids),
                        allowed,
                        VisualAsset.owner_user_id == owner,
                        VisualAsset.media_kind.in_(media),
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
                    service_id=service,
                    resource_kind=kind,
                    resource_id=record.id,
                    resource_revision=record.revision,
                    scope_project_id=project_id if kind in {"conversation", "acceptance"} else None,
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


def mount_project_pins(
    app,
    plan,
    sessions,
    *,
    prefix,
    dataset,
    service,
    kind,
    cursor,
    record_type,
    batch_type,
    page_type,
):
    mount_dataset(
        app,
        prefix=prefix,
        plan=plan,
        cursor_pattern=cursor,
        batch_model=batch_type,
        page_model=page_type,
        inventory=partial(inventory, sessions, plan, service, kind),
        page=partial(
            page, sessions, plan, dataset, service, kind, record_type, batch_type, page_type
        ),
        ingest=partial(ingest, sessions, dataset, service, kind),
    )


def mount_presentation_references(app, plan, sessions):
    for dataset, kind in REFERENCE_DATASETS.items():
        mount_project_pins(
            app,
            plan,
            sessions,
            prefix="/v1/migration/presentation/" + dataset.split(".")[1],
            dataset=dataset,
            service="presentation",
            kind=kind,
            cursor=ID,
            record_type=Projection,
            batch_type=ProjectionBatch,
            page_type=ProjectionPage,
        )


def mount_galgame_references(app, plan, sessions):
    mount_project_pins(
        app,
        plan,
        sessions,
        prefix=PINS_PATH,
        dataset=PINS_DATASET,
        service="galgame",
        kind="story",
        cursor=CURSOR,
        record_type=StoryPins,
        batch_type=StoryPinBatch,
        page_type=StoryPinPage,
    )


def mount_visual_canvas_pins(app, plan, sessions):
    mount_project_pins(
        app,
        plan,
        sessions,
        prefix=CANVAS_PINS_PATH,
        dataset=CANVAS_PINS_DATASET,
        service="visual",
        kind="canvas",
        cursor=CURSOR,
        record_type=CanvasPins,
        batch_type=CanvasPinBatch,
        page_type=CanvasPinPage,
    )


def mount_visual_conversation_pins(app, plan, sessions):
    mount_project_pins(
        app,
        plan,
        sessions,
        prefix=CONVERSATION_PINS_PATH,
        dataset=CONVERSATION_PINS_DATASET,
        service="visual",
        kind="conversation",
        cursor=CURSOR,
        record_type=ConversationPins,
        batch_type=ConversationPinBatch,
        page_type=ConversationPinPage,
    )


def mount_visual_acceptance_pins(app, plan, sessions):
    mount_project_pins(
        app,
        plan,
        sessions,
        prefix=ACCEPTANCE_PINS_PATH,
        dataset=ACCEPTANCE_PINS_DATASET,
        service="visual",
        kind="acceptance",
        cursor=CURSOR,
        record_type=CanvasPins,
        batch_type=AcceptancePinBatch,
        page_type=AcceptancePinPage,
    )


def mount_thought_references(app, plan, sessions):
    for dataset, kind in PIN_KINDS.items():
        mount_project_pins(
            app,
            plan,
            sessions,
            prefix=pin_path(dataset),
            dataset=dataset,
            service="thought",
            kind=kind,
            cursor=PIN_CURSOR,
            record_type=ThoughtPins,
            batch_type=ThoughtPinBatch,
            page_type=ThoughtPinPage,
        )
