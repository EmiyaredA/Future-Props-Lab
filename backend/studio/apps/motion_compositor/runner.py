from __future__ import annotations

import shutil

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.media_rendering.local.motion_outputs import render_outputs
from studio.apps.motion_compositor.assets import MotionAssets
from studio.apps.motion_compositor.storage.models import MotionTask
from studio.config.settings import Settings
from studio.contracts.motion_compositor.document import MotionComposition
from studio.runtime.database.ownership import bind_owner, require_owner_id
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


class MotionExportRunner(PollingTaskRunner):
    runner_name = "motion-compositor-export-runner"
    poll_interval_seconds = 1.0

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.settings = settings
        self.storage = AssetStorage(self.settings)

    async def recover(self) -> None:
        async with self.session_factory() as session:
            interrupted = list(
                (
                    await session.execute(
                        select(MotionTask.id, MotionTask.owner_user_id).where(
                            MotionTask.status == "running"
                        )
                    )
                ).all()
            )
        for task_id, raw_owner_user_id in interrupted:
            owner_user_id = require_owner_id(raw_owner_user_id, subject="motion export task")
            async with self.session_factory() as session:
                bind_owner(session, owner_user_id)
                row = await session.get(MotionTask, task_id)
                if row is None or row.status != "running":
                    continue
                row.status = "queued"
                row.progress = 0
                row.outputs = {}
                row.updated_at = utc_now()
                await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            task_id = await session.scalar(
                select(MotionTask.id)
                .where(MotionTask.status == "queued")
                .order_by(MotionTask.created_at)
                .limit(1)
            )
        if task_id:
            await self._process(task_id)

    async def _load_task(self, task_id: str) -> MotionTask | None:
        async with self.session_factory() as session:
            return await session.get(MotionTask, task_id)

    async def _set(
        self,
        task_id: str,
        *,
        status: str | None = None,
        progress: int | None = None,
        outputs: dict | None = None,
        error: str | None = None,
    ) -> None:
        async with self.session_factory() as session:
            row = await session.get(MotionTask, task_id)
            if row is None:
                return
            bind_owner(session, require_owner_id(row.owner_user_id, subject="motion export task"))
            if status is not None:
                row.status = status
            if progress is not None:
                row.progress = progress
            if outputs is not None:
                row.outputs = outputs
            row.error = error
            row.updated_at = utc_now()
            await session.commit()

    async def _cancelled(self, task_id: str) -> bool:
        row = await self._load_task(task_id)
        return row is None or row.cancel_requested

    async def _process(self, task_id: str) -> None:
        task = await self._load_task(task_id)
        if task is None or task.status != "queued":
            return
        owner_user_id = require_owner_id(task.owner_user_id, subject="motion export task")
        await self._set(task_id, status="running", progress=1)
        root = self.storage.project_root(
            "motion-compositor", task.project_id, owner_user_id=owner_user_id
        )
        target = root / "exports" / task_id
        try:
            async with self.session_factory() as session:
                bind_owner(session, owner_user_id)
                assets = await MotionAssets(session, owner_user_id, settings=self.settings).paths(
                    task.project_id
                )
            document = MotionComposition.model_validate(task.snapshot_document)
            payload = task.request_payload
            start = int(payload["startFrame"])
            end = int(payload.get("endFrame") or document.settings.duration_frames)
            formats = list(payload["formats"])
            target.parent.mkdir(parents=True, exist_ok=True)
            outputs = await render_outputs(
                document,
                assets,
                target,
                start=start,
                end=end,
                formats=formats,
                cancelled=lambda: self._cancelled(task_id),
                progress=lambda value: self._set(task_id, progress=value),
            )
            if outputs is None:
                shutil.rmtree(target, ignore_errors=True)
                await self._set(task_id, status="cancelled", progress=0)
                return
            await self._set(task_id, status="completed", progress=100, outputs=outputs)
        except Exception as exc:
            shutil.rmtree(target, ignore_errors=True)
            await self._set(task_id, status="failed", error=str(exc)[-2000:])
