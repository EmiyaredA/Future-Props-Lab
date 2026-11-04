"""Reconcile the immutable render archive with the destination Video project."""

import httpx
from sqlalchemy import select, text

from app.apps.galgame_workshop.models import GalgameVideoEditorHandoffTask
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.galgame_handoff import GalgameHandoff, HandoffMedia
from fpl_runtime.project_errors import ProjectResourceError

from .export_transfer import RenderExport
from .handoff_transfer import VideoHandoff
from .models import GalgameHandoffDispatch

TERMINAL = {"completed", "failed", "cancelled"}


class HandoffRunner(PollingTaskRunner):
    runner_name = "galgame-video-editor-handoffs"
    poll_interval_seconds = 2

    def __init__(self, state):
        super().__init__()
        self.capabilities = state.capabilities
        self.sessions = state.database.sessions

    async def recover(self):
        # Both peers replay the frozen dispatch and its exact destination receipt.
        pass

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as db:
            rows = list(
                await db.execute(
                    select(GalgameHandoffDispatch.owner_user_id, GalgameHandoffDispatch.task_id)
                    .order_by(GalgameHandoffDispatch.checked_at, GalgameHandoffDispatch.task_id)
                    .limit(2)
                )
            )
        await self.run_concurrently(rows, self.run_task)

    async def claim(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            task = await db.get(GalgameVideoEditorHandoffTask, identity)
            dispatch = await db.get(GalgameHandoffDispatch, identity)
            if task is None or dispatch is None:
                return None
            now = utc_now()
            dispatch.checked_at = now
            if task.status == "queued":
                task.status, task.started_at, task.updated_at = "running", now, now
                task.progress = 2
                task.revision += 1
            await db.commit()
            return task, dispatch

    def renderer(self, project, identity, assertion, raw, *, origin=None):
        return RenderExport(
            self.capabilities,
            assertion,
            project,
            identity,
            GalgameHandoff.model_validate(raw),
            origin=origin,
        )

    async def run_task(self, selection):
        owner, identity = selection
        claimed = await self.claim(owner, identity)
        if claimed is None:
            return
        task, dispatch = claimed
        try:
            renderer = self.renderer(task.project_id, identity, dispatch.assertion, dispatch.plan)
            if task.status in TERMINAL:
                try:
                    await renderer.release()
                except ProjectResourceError as exc:
                    if exc.status == 409:
                        await renderer.cancel()
                    raise
                await self.forget(owner, identity)
                return
            if dispatch.media is not None:
                media = HandoffMedia.model_validate(dispatch.media)
                await self.transfer(
                    task, dispatch.assertion, dispatch.video_assertion, renderer, media
                )
                return
            if task.cancel_requested:
                result = await renderer.cancel()
                if result is None or result.status in TERMINAL:
                    await self.finish(task, "cancelled")
                return
            result = await renderer.status()
            if result is None:
                result = await renderer.submit()
            if result.status == "completed":
                if not isinstance(result.media, HandoffMedia):
                    raise ValueError("Rendering did not return a Video handoff archive")
                media = result.media
                target = VideoHandoff(
                    self.capabilities,
                    dispatch.assertion,
                    task.project_id,
                    identity,
                    media.content_sha256,
                )
                token = await target.receipt_token()
                if await self.start_transfer(task, media, token):
                    await self.transfer(task, dispatch.assertion, token, renderer, media)
            elif result.status in TERMINAL:
                await self.finish(task, result.status, error=result.error)
            else:
                await self.progress(task, max(2, min(85, result.progress)))
        except ProjectResourceError as exc:
            if task.status not in TERMINAL and exc.status not in {429, 502, 503, 504}:
                await self.finish(task, "failed", error=str(exc))
        except (CapabilityUnavailable, httpx.HTTPError):
            return
        except ValueError:
            if task.status not in TERMINAL:
                await self.finish(task, "failed", error="剪辑工程交接回执无效")

    async def start_transfer(self, task, media, token):
        async with self.sessions(info={"owner_user_id": task.owner_user_id}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await db.get(GalgameVideoEditorHandoffTask, task.id)
            dispatch = await db.get(GalgameHandoffDispatch, task.id)
            if row is None or row.status != "running" or row.cancel_requested or dispatch is None:
                return False
            dispatch.media, dispatch.video_assertion = media.model_dump(mode="json"), token
            row.progress, row.updated_at = 86, utc_now()
            row.revision += 1
            await db.commit()
            return True

    async def transfer(self, task, assertion, token, renderer, media):
        if not token:
            raise ValueError("missing exact Video handoff receipt authority")
        target = VideoHandoff(
            self.capabilities, assertion, task.project_id, task.id, media.content_sha256
        )
        result = await target.status(token)
        if result is None:
            if task.cancel_requested:
                await self.finish(task, "cancelled")
                return
            result = await target.publish(renderer, media)
        if result.state == "published":
            await self.finish(task, "completed", project_id=result.project_id, media=media)

    async def progress(self, task, progress):
        async with self.sessions(info={"owner_user_id": task.owner_user_id}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await db.get(GalgameVideoEditorHandoffTask, task.id)
            if row is not None and row.status == "running" and not row.cancel_requested:
                if progress > row.progress:
                    row.progress, row.updated_at = progress, utc_now()
                    row.revision += 1
                    await db.commit()

    async def finish(self, task, status, *, error=None, project_id=None, media=None):
        async with self.sessions(info={"owner_user_id": task.owner_user_id}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await db.get(GalgameVideoEditorHandoffTask, task.id)
            if row is None or row.status in TERMINAL:
                return
            row.status, row.error, row.output_project_id = status, error, project_id
            row.progress = 100 if status == "completed" else 0
            if media is not None:
                row.result_detail = {
                    **row.result_detail,
                    "trackCount": media.track_count,
                    "assetCount": media.asset_count,
                }
            row.updated_at = row.finished_at = utc_now()
            row.revision += 1
            await db.commit()

    async def release_project(self, db, owner, project, assertion, origin):
        rows = list(
            await db.execute(
                select(GalgameHandoffDispatch.task_id, GalgameHandoffDispatch.plan)
                .join(
                    GalgameVideoEditorHandoffTask,
                    GalgameVideoEditorHandoffTask.id == GalgameHandoffDispatch.task_id,
                )
                .where(
                    GalgameVideoEditorHandoffTask.project_id == project,
                    GalgameVideoEditorHandoffTask.status.in_(TERMINAL),
                )
            )
        )
        await db.rollback()
        for identity, raw in rows:
            await self.renderer(project, identity, assertion, raw, origin=origin).release()
            await self.forget(owner, identity)

    async def forget(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            dispatch = await db.get(GalgameHandoffDispatch, identity)
            if dispatch is not None:
                await db.delete(dispatch)
                await db.commit()
