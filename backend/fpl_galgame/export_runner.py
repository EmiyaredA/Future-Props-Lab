"""Settle the immutable Rendering export and one Assets publication receipt."""

import httpx
from sqlalchemy import select, text

from app.apps.galgame_workshop.models import (
    GalgameAssetMetadata,
    GalgameProjectAssetReference,
    GalgameVideoExportTask,
)
from app.apps.galgame_workshop.video.video_export_planning import EXPORT_PACKAGING_POLICY
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.galgame_exports import ExportMedia, GalgameExport
from fpl_runtime.galgame_upload import UploadReceipt
from fpl_runtime.project_errors import ProjectResourceError

from .export_transfer import RenderExport, source_path
from .models import GalgameUploadIntake, GalgameVideoDispatch
from .upload_intakes import UploadSignature

TERMINAL = {"completed", "failed", "cancelled"}


class ExportRunner(PollingTaskRunner):
    runner_name = "galgame-video-dispatch"
    poll_interval_seconds = 2

    def __init__(self, state, uploads):
        super().__init__()
        self.state, self.uploads = state, uploads
        self.sessions = state.database.sessions

    async def recover(self):
        # The claim, exact remote job and any upload receipt are already durable.
        pass

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as db:
            rows = list(
                await db.execute(
                    select(GalgameVideoDispatch.owner_user_id, GalgameVideoDispatch.task_id)
                    .order_by(GalgameVideoDispatch.checked_at, GalgameVideoDispatch.task_id)
                    .limit(2)
                )
            )
        await self.run_concurrently(rows, self.run_task)

    async def claim(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            task = await db.get(GalgameVideoExportTask, identity)
            dispatch = await db.get(GalgameVideoDispatch, identity)
            if task is None or dispatch is None:
                return None
            now = utc_now()
            dispatch.checked_at = now
            if task.status == "queued":
                task.status, task.started_at, task.updated_at = "running", now, now
                task.progress = 1
                task.result_detail = {**task.result_detail, "phase": "preparing"}
                task.revision += 1
            await db.commit()
            return task, dispatch

    async def run_task(self, row):
        owner, identity = row
        claimed = await self.claim(owner, identity)
        if claimed is None:
            return
        task, dispatch = claimed
        try:
            client = RenderExport(
                self.state.capabilities,
                dispatch.assertion,
                task.project_id,
                identity,
                GalgameExport.model_validate(dispatch.plan),
            )
            if task.status in TERMINAL:
                await self.release(task, client)
                return
            if dispatch.media is not None:
                await self.register(
                    task, dispatch, client, ExportMedia.model_validate(dispatch.media)
                )
                return
            if task.cancel_requested:
                cancelled = await client.cancel()
                if cancelled is None or cancelled.status in TERMINAL:
                    await self.finish(task, "cancelled")
                return
            result = await client.status()
            if result is None:
                result = await client.submit()
            if result.status == "completed":
                if result.media is None:
                    raise ValueError("Rendering did not return its sealed media")
                if await self.start_registration(task, result.media):
                    await self.register(task, dispatch, client, result.media)
            elif result.status in TERMINAL:
                await self.finish(task, result.status, error=result.error)
            else:
                await self.progress(task, result)
        except ProjectResourceError as exc:
            if task.status in TERMINAL:
                return
            if exc.status not in {429, 502, 503, 504}:
                await self.finish(task, "failed", error=str(exc))
        except (CapabilityUnavailable, httpx.HTTPError):
            return
        except ValueError:
            if task.status not in TERMINAL:
                await self.finish(task, "failed", error="视频导出结果格式无效")

    async def release(self, task, client):
        try:
            await client.release()
        except ProjectResourceError as exc:
            if exc.status == 409:
                await client.cancel()
            raise
        await self.forget_dispatch(task.owner_user_id, task.id)

    async def release_project(self, db, owner, project, assertion, origin):
        rows = list(
            await db.execute(
                select(GalgameVideoDispatch.task_id, GalgameVideoDispatch.plan)
                .join(
                    GalgameVideoExportTask,
                    GalgameVideoExportTask.id == GalgameVideoDispatch.task_id,
                )
                .where(
                    GalgameVideoExportTask.project_id == project,
                    GalgameVideoExportTask.status.in_(TERMINAL),
                )
            )
        )
        await db.rollback()
        for identity, plan in rows:
            client = RenderExport(
                self.state.capabilities,
                assertion,
                project,
                identity,
                GalgameExport.model_validate(plan),
                origin=origin,
            )
            await client.release()
            await self.forget_dispatch(owner, identity)

    async def forget_dispatch(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            row = await db.get(GalgameVideoDispatch, identity)
            if row is not None:
                await db.delete(row)
                await db.commit()

    async def progress(self, task, result):
        async with self.sessions(info={"owner_user_id": task.owner_user_id}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await db.get(GalgameVideoExportTask, task.id)
            if row is None or row.status != "running" or row.cancel_requested:
                return
            if result.phase == "queued":
                return
            phase = result.phase
            progress = min(90, result.progress)
            updated = {**row.result_detail, "phase": phase, "renderedMs": result.rendered_ms}
            if row.progress != progress or row.result_detail != updated:
                row.progress, row.result_detail = progress, updated
                row.updated_at = utc_now()
                row.revision += 1
                await db.commit()

    async def start_registration(self, task, media):
        async with self.sessions(info={"owner_user_id": task.owner_user_id}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await db.get(GalgameVideoExportTask, task.id)
            dispatch = await db.get(GalgameVideoDispatch, task.id)
            if row is None or row.status != "running" or row.cancel_requested or dispatch is None:
                return False
            dispatch.media = media.model_dump(mode="json")
            row.result_detail = {**row.result_detail, "phase": "registering"}
            row.progress, row.updated_at = 95, utc_now()
            row.revision += 1
            await db.commit()
            return True

    async def register(self, task, dispatch, client, media):
        if dispatch.upload_id is not None:
            async with self.sessions(info={"owner_user_id": task.owner_user_id}) as db:
                intake = await db.get(GalgameUploadIntake, dispatch.upload_id)
            if intake is not None and intake.state in {"reserved", "pending"}:
                return
            if intake is not None and intake.state == "settled":
                receipt = UploadReceipt.model_validate(intake.receipt)
                await self.complete_output(task, media, receipt.items[0].id)
                return

        async def attach_intake(db, identity):
            active = await db.get(GalgameVideoDispatch, task.id)
            if active is None or active.upload_id != dispatch.upload_id:
                raise ProjectResourceError("成片登记状态已变化", "export_intake_changed", 409)
            active.upload_id = identity

        signature = UploadSignature(
            media.filename, media.mime_type, media.byte_size, media.content_sha256
        )
        async with client.download(media) as stream:
            pending, manifest = await self.uploads.reserve(
                task.owner_user_id,
                task.project_id,
                "video",
                [signature],
                "export",
                assertion=dispatch.assertion,
                source_path=source_path(task.project_id),
                on_reserve=attach_intake,
            )
            items, _ = await self.uploads.upload(pending, manifest, [stream])
        await self.complete_output(task, media, items[0].id)

    async def complete_output(self, task, media, asset_id):
        async with self.sessions(info={"owner_user_id": task.owner_user_id}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await db.get(GalgameVideoExportTask, task.id)
            metadata = await db.get(GalgameAssetMetadata, asset_id)
            if row is None or row.status != "running":
                return
            if (
                metadata is None
                or metadata.project_id != task.project_id
                or metadata.checksum_sha256 != media.content_sha256
            ):
                raise ProjectResourceError("成片素材回执无效", "export_asset_receipt_changed", 409)
            metadata.width, metadata.height = media.width, media.height
            metadata.duration_ms, metadata.packaging_policy = (
                media.duration_ms,
                EXPORT_PACKAGING_POLICY,
            )
            metadata.updated_at = utc_now()
            existing = await db.scalar(
                select(GalgameProjectAssetReference.id).where(
                    GalgameProjectAssetReference.project_id == task.project_id,
                    GalgameProjectAssetReference.asset_id == asset_id,
                )
            )
            if existing is None:
                db.add(GalgameProjectAssetReference(project_id=task.project_id, asset_id=asset_id))
            row.output_asset_id = asset_id
            row.result_detail = {
                **row.result_detail,
                "phase": "completed",
                "outputFilename": media.filename,
                "renderedMs": row.result_detail["totalMs"],
            }
            self.mark_finished(row, "completed", None)
            row.progress = 100
            await db.commit()

    async def finish(self, task, status, *, error=None):
        async with self.sessions(info={"owner_user_id": task.owner_user_id}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await db.get(GalgameVideoExportTask, task.id)
            if row is not None and row.status not in TERMINAL:
                row.result_detail = {**row.result_detail, "phase": status}
                self.mark_finished(row, status, error)
                await db.commit()

    @staticmethod
    def mark_finished(task, status, error):
        now = utc_now()
        task.status, task.error = status, error
        task.finished_at, task.updated_at = now, now
        task.revision += 1
