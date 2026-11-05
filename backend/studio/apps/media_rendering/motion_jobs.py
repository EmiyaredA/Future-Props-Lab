"""Run a sealed export from Rendering-owned files and publish only complete outputs."""

from shutil import rmtree

from anyio.to_thread import run_sync
from sqlalchemy import select, update

from app.capabilities.media_rendering.motion_document import MotionComposition
from app.capabilities.media_rendering.motion_outputs import render_outputs
from studio.apps.media_rendering.storage.file_paths import sync_directory, sync_files
from studio.apps.media_rendering.storage.service_models import MotionRenderJob
from studio.contracts.motion_compositor.motion_exports import RenderRequest, RenderStatus
from studio.runtime.http.capability_client import CapabilityUnavailable
from studio.runtime.tasks.polling import PollingTaskRunner


class MotionJobs(PollingTaskRunner):
    runner_name = "rendering-motion-exports"
    poll_interval_seconds = 1.0

    def __init__(self, *, database, settings, identity):
        super().__init__()
        self.database = database
        self.settings = settings
        self.identity = identity

    def session(self, owner):
        return self.database.sessions(info={"owner_user_id": owner})

    def folder(self, owner, task_id):
        account = self.settings.account_path(owner)
        directory = account / "motion-exports" / task_id
        if not directory.resolve().is_relative_to(account) or directory.is_symlink():
            raise ValueError("特效导出暂存目录无效")
        return directory

    async def load(self, owner, task_id):
        async with self.session(owner) as session:
            return await session.get(MotionRenderJob, (owner, task_id))

    @staticmethod
    def receipt(job):
        return RenderStatus(
            status=job.status, progress=job.progress, outputs=job.outputs, error=job.error
        )

    async def enqueue(self, *, owner, project, task_id, path, assertion, payload):
        async with self.session(owner) as session:
            job = MotionRenderJob(
                id=task_id,
                owner_user_id=owner,
                project_id=project,
                request_path=path,
                assertion=assertion,
                payload=payload.model_dump(mode="json"),
            )
            session.add(job)
            await session.commit()
        return self.receipt(job)

    async def cancel(self, owner, task_id):
        async with self.session(owner) as session:
            await session.execute(
                update(MotionRenderJob)
                .where(
                    MotionRenderJob.id == task_id, MotionRenderJob.status.in_(("queued", "running"))
                )
                .values(cancel_requested=True)
            )
            await session.commit()

    async def set_state(self, job, *, pending=None, **values):
        statement = update(MotionRenderJob).where(MotionRenderJob.id == job.id)
        if pending is not None:
            statement = statement.where(MotionRenderJob.status == pending)
        if values.get("status") == "completed":
            values["assertion"] = ""
            statement = statement.where(MotionRenderJob.cancel_requested.is_(False))
        async with self.session(job.owner_user_id) as session:
            result = await session.execute(statement.values(**values))
            await session.commit()
            return result.rowcount == 1

    async def recover(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            interrupted = (
                await session.scalars(
                    select(MotionRenderJob).where(MotionRenderJob.status == "running")
                )
            ).all()
        for job in interrupted:
            await self.set_state(job, pending="running", status="queued", progress=0)

    async def process_once(self):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            job = await session.scalar(
                select(MotionRenderJob)
                .where(MotionRenderJob.status == "queued")
                .order_by(MotionRenderJob.created_at, MotionRenderJob.id)
                .limit(1)
            )
        if job is not None:
            await self.execute(job)

    async def stopped(self, job):
        current = await self.load(job.owner_user_id, job.id)
        if current is None or current.cancel_requested:
            return True
        active = await self.identity.status(
            assertion=job.assertion, method="POST", path=job.request_path
        )
        if active is None:
            raise CapabilityUnavailable("特效导出授权暂不可用")
        return not active

    async def execute(self, job):
        folder = self.folder(job.owner_user_id, job.id)
        if not await self.set_state(job, pending="queued", status="running", progress=1):
            return
        target = folder / "outputs"
        try:
            await run_sync(lambda: rmtree(target, ignore_errors=True))
            if await self.stopped(job):
                await self.set_state(job, status="cancelled", progress=0, assertion="")
                return
            if not folder.is_dir():
                raise ValueError("已封存的导出原件不可用")
            request = RenderRequest.model_validate(job.payload)
            document = MotionComposition.model_validate(request.document)
            media = {item.id: folder / "inputs" / item.id for item in request.scope.files}
            if any(path.is_symlink() or not path.is_file() for path in media.values()):
                raise ValueError("已封存的导出原件不可用")
            outputs = await render_outputs(
                document,
                media,
                target,
                start=request.window.start,
                end=request.window.end,
                formats=request.window.formats,
                cancelled=lambda: self.stopped(job),
                progress=lambda value: self.set_state(job, progress=value),
            )
            if outputs is not None:
                await run_sync(sync_files, target)
                await run_sync(sync_directory, folder)
            if outputs is not None and await self.set_state(
                job, status="completed", progress=100, outputs=outputs
            ):
                await run_sync(lambda: rmtree(folder / "inputs", ignore_errors=True))
                return
            await self.set_state(job, status="cancelled", progress=0, assertion="")
        except CapabilityUnavailable:
            await self.set_state(job, status="queued", progress=0)
            raise
        except Exception:
            await self.set_state(job, status="failed", error="特效导出失败", assertion="")
        finally:
            current = await self.load(job.owner_user_id, job.id)
            if current is not None and current.status in {"failed", "cancelled"}:
                await run_sync(lambda: rmtree(folder, ignore_errors=True))
