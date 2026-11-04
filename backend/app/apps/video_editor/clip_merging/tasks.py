from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.video_editor.clip_merging.context import fingerprints
from app.apps.video_editor.clip_merging.document import selection
from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.apps.video_editor.models import (
    VideoEditorTask,
    VideoEditorTimeline,
)
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.schemas import VideoEditorTaskListOut, VideoEditorTaskOut
from app.apps.video_editor.schemas.clip_merge import VideoEditorClipMergeCreateIn
from app.apps.video_editor.task_reads import task_out
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now


class VideoEditorClipMerges:
    def __init__(self, session: AsyncSession, owner_user_id: str, *, dispatch=None) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.dispatch = dispatch

    async def row(self, project_id: str, task_id: str) -> VideoEditorTask:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        row = await self.session.scalar(
            select(VideoEditorTask).where(
                VideoEditorTask.id == task_id,
                VideoEditorTask.project_id == project_id,
                VideoEditorTask.owner_user_id == self.owner_user_id,
                VideoEditorTask.kind == "clip_merge",
            )
        )
        if row is None:
            raise VideoEditorNotFoundError("片段合并任务不存在")
        return row

    async def create(
        self, project_id: str, body: VideoEditorClipMergeCreateIn
    ) -> VideoEditorTaskOut:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        payload = body.model_dump(mode="json", by_alias=True)
        existing = await self._existing(project_id, body.request_id, payload)
        if existing is not None:
            return task_out(existing)
        timeline = await self._timeline(project_id, body.expected_revision)
        document = timeline.document
        source = selection(document, body.clip_ids)
        assets = self.session.info["video_timeline_assets"](self.session, self.owner_user_id)
        source_assets = await fingerprints(assets, project_id, source)
        if self.dispatch is not None:
            await assets.guard_write(project_id)
            existing = await self._existing(project_id, body.request_id, payload)
            if existing is not None:
                return task_out(existing)
            await self._timeline(project_id, body.expected_revision)
        task = VideoEditorTask(
            owner_user_id=self.owner_user_id,
            project_id=project_id,
            request_id=body.request_id,
            kind="clip_merge",
            request_payload=payload,
            snapshot_document=document,
            result_detail={"source": source, "sourceAssets": source_assets, "name": body.name},
        )
        self.session.add(task)
        if self.dispatch is not None:
            self.dispatch(self.session, task)
        await self.session.commit()
        await self.session.refresh(task)
        return task_out(task)

    async def _existing(self, project_id, request_id, payload):
        existing = await self.session.scalar(
            select(VideoEditorTask).where(
                VideoEditorTask.project_id == project_id,
                VideoEditorTask.owner_user_id == self.owner_user_id,
                VideoEditorTask.request_id == request_id,
            )
        )
        if existing:
            if existing.kind != "clip_merge" or existing.request_payload != payload:
                raise VideoEditorValidationError(
                    "requestId 已用于不同任务", code="request_id_reused"
                )
        return existing

    async def _timeline(self, project_id, expected):
        timeline = await self.session.get(VideoEditorTimeline, project_id, populate_existing=True)
        if timeline is None:
            raise VideoEditorNotFoundError("时间轴不存在")
        if timeline.revision != expected:
            raise RevisionConflictError(
                expected,
                timeline.revision,
                {"revision": timeline.revision, "document": timeline.document},
            )
        return timeline

    async def get(self, project_id: str, task_id: str) -> VideoEditorTaskOut:
        return task_out(await self.row(project_id, task_id))

    async def list(self, project_id: str) -> VideoEditorTaskListOut:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        rows = await self.session.scalars(
            select(VideoEditorTask)
            .where(
                VideoEditorTask.project_id == project_id,
                VideoEditorTask.owner_user_id == self.owner_user_id,
                VideoEditorTask.kind == "clip_merge",
            )
            .order_by(VideoEditorTask.created_at.desc())
        )
        return VideoEditorTaskListOut(items=[task_out(row) for row in rows])

    async def cancel(self, project_id: str, task_id: str) -> VideoEditorTaskOut:
        row = await self.row(project_id, task_id)
        if row.status in {"queued", "running"}:
            row.cancel_requested = True
            if row.status == "queued":
                row.status = "cancelled"
            row.revision += 1
            row.updated_at = utc_now()
            await self.session.commit()
        return task_out(row)
