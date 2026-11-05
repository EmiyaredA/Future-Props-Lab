from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.motion_outputs import OUTPUT_NAMES
from studio.apps.motion_compositor.projects import MotionInvalid, MotionNotFound, MotionProjects
from studio.apps.motion_compositor.schemas import (
    ExportCreateIn,
    ExportListOut,
    ExportOut,
    HandoffIn,
    HandoffOut,
)
from studio.apps.motion_compositor.storage.models import MotionDocument, MotionTask
from studio.apps.video_editor.handoffs.motion_handoff import import_motion_export
from studio.config.settings import get_settings
from studio.contracts.motion_compositor.document import MotionComposition
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now


class MotionExports:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.projects = MotionProjects(session, owner_user_id)
        self.storage = AssetStorage(get_settings())

    def _out(self, row: MotionTask) -> ExportOut:
        base = f"/v1/motion-compositor/projects/{row.project_id}/exports/{row.id}"
        return ExportOut(
            id=row.id,
            status=row.status,
            progress=row.progress,
            formats=list(row.request_payload.get("formats", [])),
            outputs={key: f"{base}/download/{key}" for key in row.outputs},
            error=row.error,
        )

    async def row(self, project_id: str, task_id: str) -> MotionTask:
        await self.projects.row(project_id)
        row = (
            await self.session.execute(
                select(MotionTask).where(
                    MotionTask.id == task_id,
                    MotionTask.project_id == project_id,
                    MotionTask.owner_user_id == self.owner_user_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise MotionNotFound("导出任务不存在")
        return row

    async def create(self, project_id: str, body: ExportCreateIn) -> ExportOut:
        await self.projects.row(project_id)
        payload = body.model_dump(mode="json", by_alias=True)
        existing = (
            await self.session.execute(
                select(MotionTask).where(
                    MotionTask.project_id == project_id, MotionTask.request_id == body.request_id
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.request_payload != payload:
                raise MotionInvalid("requestId 已用于不同导出任务")
            return self._out(existing)
        row = await self.session.get(MotionDocument, project_id)
        if row is None:
            raise MotionNotFound("特效文档不存在")
        if row.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                row.revision,
                {"revision": row.revision, "document": row.document},
            )
        document = MotionComposition.model_validate(row.document)
        if (
            body.start_frame >= document.settings.duration_frames
            or (body.end_frame or document.settings.duration_frames)
            > document.settings.duration_frames
        ):
            raise MotionInvalid("导出范围超出项目时长")
        task = MotionTask(
            owner_user_id=self.owner_user_id,
            project_id=project_id,
            request_id=body.request_id,
            request_payload=payload,
            snapshot_document=row.document,
            outputs={},
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return self._out(task)

    async def list(self, project_id: str) -> ExportListOut:
        await self.projects.row(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(MotionTask)
                    .where(
                        MotionTask.project_id == project_id,
                        MotionTask.owner_user_id == self.owner_user_id,
                    )
                    .order_by(MotionTask.created_at.desc())
                )
            ).scalars()
        )
        return ExportListOut(items=[self._out(row) for row in rows])

    async def get(self, project_id: str, task_id: str) -> ExportOut:
        return self._out(await self.row(project_id, task_id))

    async def cancel(self, project_id: str, task_id: str) -> ExportOut:
        row = await self.row(project_id, task_id)
        if row.status in {"queued", "running"}:
            row.cancel_requested = True
            if row.status == "queued":
                row.status = "cancelled"
            row.updated_at = utc_now()
            await self.session.commit()
        return self._out(row)

    async def download(self, project_id: str, task_id: str, format_name: str) -> tuple[Path, str]:
        row = await self.row(project_id, task_id)
        if row.status != "completed" or format_name not in row.outputs:
            raise MotionNotFound("导出文件不存在")
        filename = OUTPUT_NAMES.get(format_name)
        if not filename or row.outputs[format_name] != filename:
            raise MotionNotFound("导出文件不存在")
        path = (
            self.storage.project_root(
                "motion-compositor", project_id, owner_user_id=self.owner_user_id
            )
            / "exports"
            / row.id
            / filename
        )
        if not path.is_file():
            raise MotionNotFound("导出文件不存在")
        return path, filename

    async def handoff(self, project_id: str, task_id: str, body: HandoffIn) -> HandoffOut:
        task = await self.row(project_id, task_id)
        source, filename = await self.download(project_id, task_id, body.format)
        document = MotionComposition.model_validate(task.snapshot_document)
        start = int(task.request_payload["startFrame"])
        end = int(task.request_payload.get("endFrame") or document.settings.duration_frames)
        duration_us = round((end - start) * 1_000_000 / document.settings.fps)
        target_id, asset_id = await import_motion_export(
            self.session,
            self.owner_user_id,
            source,
            filename=filename,
            duration_us=duration_us,
            target_project_id=body.target_project_id,
            new_project_title=body.new_project_title,
        )
        return HandoffOut(projectId=target_id, assetId=asset_id)
