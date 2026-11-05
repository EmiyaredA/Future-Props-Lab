"""Render and seal a Galgame MP4 from the immutable admitted route."""

import asyncio
import os
from dataclasses import asdict
from pathlib import Path
from shutil import rmtree
from tempfile import TemporaryDirectory
from threading import Event
from types import SimpleNamespace

from anyio.to_thread import run_sync
from fastapi import HTTPException
from sqlalchemy import select, text

from studio.apps.media_rendering.local.galgame.export_output import verify_galgame_video
from studio.apps.media_rendering.local.render_engine import RenderCancelled, render_plan
from studio.apps.media_rendering.storage.file_paths import sync_directory, sync_files
from studio.apps.media_rendering.storage.service_models import GalgameExportJob
from studio.contracts.galgame_workshop.galgame_exports import (
    INPUTS,
    ExportMedia,
    ExportReceipt,
    GalgameExport,
)
from studio.contracts.galgame_workshop.galgame_handoff import (
    HANDOFF_INPUTS,
    HANDOFF_JOBS,
    GalgameHandoff,
)
from studio.runtime.files.signed_payloads import ModelOutputDescription
from studio.runtime.http.capability_client import CapabilityUnavailable
from studio.runtime.tasks.polling import PollingTaskRunner

from .galgame_frames import prepare_plan
from .galgame_handoff_package import make_handoff_archive
from .scoped_originals import original_files


def receipt(job):
    return ExportReceipt(
        status=job.status,
        phase=job.phase,
        progress=job.progress,
        rendered_ms=job.rendered_ms,
        error=job.error,
        media=job.media,
    )


class GalgameExports(PollingTaskRunner):
    runner_name = "galgame-video-exports"
    poll_interval_seconds = 1

    def __init__(self, database, settings, identity, capabilities):
        super().__init__()
        self.state = SimpleNamespace(
            settings=settings, identity=identity, capabilities=capabilities
        )
        self.sessions = database.sessions

    def folder(self, owner, identity):
        account = self.state.settings.account_path(owner)
        result = account / ".tmp" / "galgame-exports" / identity
        if result.is_symlink() or not result.resolve().is_relative_to(account):
            raise HTTPException(503, "galgame_export_staging_unavailable")
        return result

    async def enqueue(self, owner, project, identity, fingerprint, path, assertion, inputs, body):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            job = await db.get(GalgameExportJob, (owner, identity))
            if job is not None:
                self.require_exact(job, project, fingerprint)
                return receipt(job)
            job = GalgameExportJob(
                owner_user_id=owner,
                id=identity,
                project_id=project,
                fingerprint=fingerprint,
                request_path=path,
                assertion=assertion,
                input_assertion=inputs,
                payload=body.model_dump(mode="json"),
            )
            db.add(job)
            await db.commit()
            return receipt(job)

    @staticmethod
    def require_exact(job, project, fingerprint):
        if job is None or job.project_id != project:
            raise HTTPException(404, "galgame_render_job_missing")
        if job.fingerprint != fingerprint:
            raise HTTPException(409, "galgame_render_job_changed")

    async def get(self, owner, project, identity, fingerprint):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            job = await db.get(GalgameExportJob, (owner, identity))
            self.require_exact(job, project, fingerprint)
            return job

    async def cancel(self, owner, project, identity, fingerprint):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            job = await db.get(GalgameExportJob, (owner, identity))
            self.require_exact(job, project, fingerprint)
            if job.status in {"queued", "running"}:
                job.cancel_requested = True
                if job.status == "queued":
                    job.status = job.phase = "cancelled"
                    job.assertion = job.input_assertion = ""
            await db.commit()
            return receipt(job)

    async def release(self, owner, project, identity, fingerprint):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            job = await db.get(GalgameExportJob, (owner, identity))
            self.require_exact(job, project, fingerprint)
            if job.status not in {"completed", "cancelled", "failed"}:
                raise HTTPException(409, "galgame_render_job_pending")
            job.released = True
            await db.commit()
        try:
            await run_sync(rmtree, self.folder(owner, identity))
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise HTTPException(503, "galgame_render_release_pending") from exc
        return {"released": True}

    async def set_state(self, job, **changes):
        async with self.sessions(info={"owner_user_id": job.owner_user_id}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await db.get(GalgameExportJob, (job.owner_user_id, job.id))
            if row.cancel_requested and changes.get("status") in {"running", "completed"}:
                raise RenderCancelled("Galgame 视频导出已取消")
            for name, value in changes.items():
                setattr(row, name, value)
            await db.commit()

    async def recover(self):
        async with self.sessions(info={"allow_system_reads": True}) as db:
            running = list(
                await db.scalars(
                    select(GalgameExportJob).where(GalgameExportJob.status == "running")
                )
            )
        for job in running:
            await self.set_state(job, status="queued", phase="queued", progress=0, rendered_ms=0)

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as db:
            job = await db.scalar(
                select(GalgameExportJob)
                .where(GalgameExportJob.status == "queued")
                .order_by(GalgameExportJob.created_at, GalgameExportJob.id)
                .limit(1)
            )
        if job is not None:
            await self.render(job)

    async def require_running(self, job):
        current = await self.get(job.owner_user_id, job.project_id, job.id, job.fingerprint)
        if current.cancel_requested or current.status == "cancelled":
            raise RenderCancelled("Galgame 视频导出已取消")
        active = await self.state.identity.status(
            assertion=job.assertion, method="POST", path=job.request_path
        )
        if active is False:
            raise RenderCancelled("Galgame 视频导出授权已结束")
        if active is None:
            raise CapabilityUnavailable("Galgame 导出授权暂不可核验")

    async def monitored(self, job, call, stop, *, progress=None, duration_ms=0):
        task = asyncio.create_task(asyncio.to_thread(call))
        try:
            while not task.done():
                if not (await asyncio.wait((task,), timeout=1))[0]:
                    await self.require_running(job)
                    if progress is not None:
                        value = progress[0]
                        await self.set_state(
                            job, progress=value, rendered_ms=round(duration_ms * value / 88)
                        )
            return await task
        finally:
            if not task.done():
                stop.set()
                await asyncio.gather(task, return_exceptions=True)

    async def render(self, job):
        folder = self.folder(job.owner_user_id, job.id)
        try:
            await self.require_running(job)
            await self.set_state(job, status="running", phase="preparing", progress=1)
            if folder.exists():
                await run_sync(rmtree, folder)
            folder.mkdir(parents=True, exist_ok=False, mode=0o700)
            model = (
                GalgameHandoff if job.request_path.startswith(HANDOFF_JOBS + "/") else GalgameExport
            )
            body = model.model_validate(job.payload)
            media = await self.encode(job, body, folder)
            await self.require_running(job)
            await self.set_state(
                job,
                status="completed",
                phase="completed",
                progress=100,
                rendered_ms=body.total_ms,
                media=media.model_dump(mode="json"),
                assertion="",
                input_assertion="",
            )
        except RenderCancelled:
            await self.set_state(
                job,
                status="cancelled",
                phase="cancelled",
                progress=0,
                assertion="",
                input_assertion="",
            )
            await run_sync(lambda: rmtree(folder, ignore_errors=True))
        except (CapabilityUnavailable, HTTPException) as exc:
            if isinstance(exc, CapabilityUnavailable) or exc.status_code in {502, 503, 504}:
                await self.set_state(
                    job, status="queued", phase="queued", progress=0, rendered_ms=0
                )
                raise
            await self.fail(job, folder, str(getattr(exc, "detail", exc)))
        except Exception as exc:
            await self.fail(job, folder, str(exc))

    async def fail(self, job, folder, error):
        await self.set_state(
            job,
            status="failed",
            phase="failed",
            error=error[:4000],
            assertion="",
            input_assertion="",
        )
        await run_sync(lambda: rmtree(folder, ignore_errors=True))

    async def encode(self, job, body, folder):
        account = self.state.settings.account_path(job.owner_user_id)
        cache = account / "derived" / "galgame-envelopes"
        if cache.is_symlink() or not cache.resolve().is_relative_to(account):
            raise HTTPException(503, "galgame_export_staging_unavailable")
        cache.mkdir(parents=True, exist_ok=True, mode=0o700)
        stop = Event()
        with TemporaryDirectory(dir=folder, prefix="work-") as temporary:
            staging = Path(temporary)
            source_folder = staging / "source"
            source_folder.mkdir()
            prefix = HANDOFF_INPUTS if isinstance(body, GalgameHandoff) else INPUTS
            path = f"{prefix}/{job.project_id}/{job.id}/{body.scope.digest}"
            originals = await original_files(
                self.state, body.scope, body.sizes, path, job.input_assertion, source_folder
            )
            await self.require_running(job)
            await self.set_state(job, phase="analyzing", progress=2)
            plan = await self.monitored(
                job, lambda: prepare_plan(body, originals, cache, cancel=stop), stop
            )
            await self.require_running(job)
            if isinstance(body, GalgameHandoff):
                await self.set_state(job, phase="verifying", progress=84)
                archive, media = await make_handoff_archive(
                    self.state.settings.runtime_path, job.project_id, body, plan
                )
                try:
                    await self.seal(folder, archive, "output.zip")
                finally:
                    archive.unlink(missing_ok=True)
                return media
            await self.set_state(job, phase="rendering", progress=3)
            progress = [3]
            output = staging / "output.mp4"

            def report(value):
                progress[0] = max(3, min(88, value))

            def encode():
                render_plan(
                    plan,
                    output,
                    preset=body.payload["preset"],
                    start_us=0,
                    end_us=max(1, body.total_ms * 1000),
                    cancel=stop,
                    progress=report,
                )

            await self.monitored(job, encode, stop, progress=progress, duration_ms=body.total_ms)
            await self.require_running(job)
            await self.set_state(job, phase="verifying", progress=90, rendered_ms=body.total_ms)
            width, height, duration = await run_sync(
                verify_galgame_video, output, body.payload["preset"], body.total_ms
            )
            description = await run_sync(
                ModelOutputDescription.from_file, output, body.filename, "video/mp4"
            )
            await self.seal(folder, output, "output.mp4")
            return ExportMedia(
                **asdict(description), width=width, height=height, duration_ms=duration
            )

    @staticmethod
    async def seal(folder, source, filename):
        sealed = folder / "sealed"
        sealed.mkdir()
        os.replace(source, sealed / filename)
        await run_sync(sync_files, sealed)
        await run_sync(sync_directory, folder)
