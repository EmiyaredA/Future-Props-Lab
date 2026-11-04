"""Import verified historical render output and activate its exact owned receipt."""

import asyncio
from uuid import UUID

from fastapi import HTTPException, Request, Response
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from fpl_runtime.artifact_migration_source import artifact_page
from fpl_runtime.editing_artifacts import (
    MOTION_DATASET,
    MOTION_PREFIX,
    VIDEO_DATASET,
    VIDEO_PREFIX,
    MotionRenderBatch,
    MotionRenderHistory,
    MotionRenderPage,
    VideoDerivativeBatch,
    VideoDerivativeHistory,
    VideoDerivativePage,
    file_receipt,
    motion_render_id,
    video_media_id,
)
from fpl_runtime.migration_apps import import_app, mount_dataset
from fpl_runtime.migration_batches import MigrationAdmission
from fpl_runtime.migration_files import checked_path, import_blob, inspect_blob
from fpl_runtime.migration_receipts import batch_receipt, has_receipt, record_receipt
from fpl_runtime.project_history_migration import CURSOR

from .migrations.registry import MIGRATIONS
from .models import (
    MotionRenderJob,
    RenderingHistoryManifest,
    RenderingMigrationReceipt,
    VideoMediaJob,
)

DATASETS = (
    (MOTION_DATASET, MOTION_PREFIX, MotionRenderHistory, MotionRenderBatch, MotionRenderPage),
    (
        VIDEO_DATASET,
        VIDEO_PREFIX,
        VideoDerivativeHistory,
        VideoDerivativeBatch,
        VideoDerivativePage,
    ),
)
CHANGED = "migration_rendering_artifact_changed"


def blocked(code):
    return HTTPException(409, {"code": code})


class HistoricalMedia:
    def __init__(self, plan, database, dataset, record, batch, page):
        self.plan, self.database, self.dataset = plan, database, dataset
        self.record, self.batch, self.page_type = record, batch, page

    def sessions(self, owner):
        return self.database.sessions(info={"owner_user_id": str(owner)})

    async def inventory(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as db:
            counts = dict(
                (
                    await db.execute(
                        select(RenderingHistoryManifest.owner_user_id, func.count())
                        .where(RenderingHistoryManifest.dataset == self.dataset)
                        .group_by(RenderingHistoryManifest.owner_user_id)
                    )
                ).all()
            )
        if set(counts) - {str(owner) for owner in self.plan.owner_ids}:
            raise blocked("migration_owner_unassigned")
        return {"record_count": sum(counts.values())}

    async def page(self, owner_id, after):
        async with self.sessions(owner_id) as db:
            rows = list(
                await db.scalars(
                    select(RenderingHistoryManifest)
                    .where(
                        RenderingHistoryManifest.dataset == self.dataset,
                        RenderingHistoryManifest.id > (after or ""),
                    )
                    .order_by(RenderingHistoryManifest.id)
                    .limit(2)
                )
            )
        records = (self.record.model_validate(rows[0].manifest),) if rows else ()
        return artifact_page(
            self.plan,
            owner_id,
            after,
            self.dataset,
            self.batch,
            self.page_type,
            records,
            more=len(rows) > 1,
        )

    async def ingest(self, batch):
        if len(batch.records) > 1:
            raise HTTPException(422, {"code": "migration_record_order_invalid"})
        receipt = batch_receipt(batch)
        async with self.sessions(batch.owner_id) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            if await has_receipt(db, RenderingMigrationReceipt, receipt):
                return receipt
            for value in batch.records:
                db.add(
                    RenderingHistoryManifest(
                        owner_user_id=str(batch.owner_id),
                        dataset=self.dataset,
                        id=value.id,
                        manifest=value.model_dump(mode="json"),
                    )
                )
            record_receipt(db, RenderingMigrationReceipt, receipt)
            try:
                await db.commit()
            except IntegrityError:
                raise blocked("migration_rendering_artifact_overlap") from None
        return receipt

    async def lookup(self, owner, identity, key, digest):
        async with self.sessions(owner) as db:
            row = await db.get(RenderingHistoryManifest, (str(owner), self.dataset, identity))
        if row is None:
            raise HTTPException(404, {"code": "migration_rendering_artifact_missing"})
        item = self.record.model_validate(row.manifest)
        file = next((value for value in item.files if value.key == key), None)
        if file is None or digest != file.sha256:
            raise blocked(CHANGED)
        return item, file

    def destination(self, owner, identity, filename):
        kind, job = (
            ("motion-exports", motion_render_id(identity))
            if self.dataset == MOTION_DATASET
            else ("video-media", video_media_id(identity))
        )
        return checked_path(
            self.database.root, "accounts", str(owner), kind, job, "outputs", filename
        )

    async def store(self, request, owner, item, file):
        try:
            target = self.destination(owner, item.id, file.filename)
            await import_blob(
                request.stream(),
                root=self.database.root,
                target=target,
                staging=checked_path(self.database.root, ".migration-artifacts"),
                size=file.size,
                digest=file.sha256,
            )
        except (OSError, ValueError):
            raise blocked(CHANGED) from None
        receipt = file_receipt(self.plan, owner, self.dataset, item.id, file)
        async with self.sessions(owner) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            if not await has_receipt(db, RenderingMigrationReceipt, receipt):
                record_receipt(db, RenderingMigrationReceipt, receipt)
                other = [
                    file_receipt(self.plan, owner, self.dataset, item.id, value)
                    for value in item.files
                    if value.key != file.key
                ]
                if all(
                    [await has_receipt(db, RenderingMigrationReceipt, prior) for prior in other]
                ):
                    db.add(self.job(str(owner), item))
                try:
                    await db.commit()
                except IntegrityError:
                    raise blocked("migration_rendering_job_overlap") from None
        return receipt

    def job(self, owner, item):
        outputs = {file.key: file.filename for file in item.files}
        if self.dataset == MOTION_DATASET:
            return MotionRenderJob(
                id=motion_render_id(item.id),
                owner_user_id=owner,
                project_id=item.project_id,
                request_path="",
                assertion="",
                payload={},
                status="completed",
                progress=100,
                outputs=outputs,
                created_at=item.created_at,
            )
        return VideoMediaJob(
            id=video_media_id(item.id),
            owner_user_id=owner,
            project_id=item.project_id,
            asset_id=item.id,
            status="completed",
            probe=item.probe,
            fingerprint=item.source_sha256,
            outputs=outputs,
            created_at=item.created_at,
        )

    async def verify(self, owner, item, file):
        try:
            target = self.destination(owner, item.id, file.filename)
            size, digest = await asyncio.to_thread(inspect_blob, target, exact_size=file.size)
        except (OSError, ValueError):
            raise blocked(CHANGED) from None
        if digest != file.sha256:
            raise blocked(CHANGED)
        async with self.sessions(owner) as db:
            receipt = file_receipt(self.plan, owner, self.dataset, item.id, file)
            if not await has_receipt(db, RenderingMigrationReceipt, receipt):
                raise blocked("migration_rendering_artifact_unconfirmed")
        return Response(headers={"Content-Length": str(size), "X-Fpl-Artifact-SHA256": digest})


def mount_files(app, plan, prefix, media):
    admission = MigrationAdmission(plan)
    path = prefix + "/files/{owner_id}/{record_id}/{key}/{sha256}"

    @app.put(path)
    async def write_file(request: Request, owner_id: UUID, record_id: str, key: str, sha256: str):
        admission.check_owner(owner_id)
        record, file = await media.lookup(owner_id, record_id, key, sha256)
        return await media.store(request, owner_id, record, file)

    @app.head(path)
    async def verify_file(owner_id: UUID, record_id: str, key: str, sha256: str):
        admission.check_owner(owner_id)
        record, file = await media.lookup(owner_id, record_id, key, sha256)
        return await media.verify(owner_id, record, file)


def create_import_app(*, plan, state_root):
    models = (MotionRenderJob, VideoMediaJob, RenderingHistoryManifest, RenderingMigrationReceipt)
    app, database = import_app(
        plan,
        state_root,
        "rendering",
        models,
        MIGRATIONS,
        streaming_prefix=tuple(prefix + "/files/" for _dataset, prefix, *_spec in DATASETS),
    )
    for dataset, prefix, record, batch, page in DATASETS:
        media = HistoricalMedia(plan, database, dataset, record, batch, page)
        mount_dataset(
            app,
            prefix=prefix,
            plan=plan,
            cursor_pattern=CURSOR,
            batch_model=batch,
            page_model=page,
            inventory=media.inventory,
            page=media.page,
            ingest=media.ingest,
        )
        mount_files(app, plan, prefix, media)
    return app
