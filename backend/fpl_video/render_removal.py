"""Remove a terminal render and its exact published output as one source decision."""

from sqlalchemy import delete, select, text

from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.apps.video_editor.models import VideoEditorTask
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.task_reads import task_out
from app.apps.video_editor.timeline_file_removal import uses_file
from app.capabilities.asset_store.errors import AssetError
from app.runtime.revisions import RevisionConflictError

from .media_edits import MediaEdits
from .models import VideoRenderDispatch

TERMINAL = frozenset({"completed", "failed", "cancelled"})


class RenderRemoval:
    def __init__(self, request, session, owner):
        self.request, self.session, self.owner = request, session, owner

    async def _task(self, project, task, expected):
        row = await self.session.scalar(
            select(VideoEditorTask).where(
                VideoEditorTask.id == task,
                VideoEditorTask.project_id == project,
                VideoEditorTask.owner_user_id == self.owner,
                VideoEditorTask.kind == "render",
            )
        )
        if row is None:
            raise VideoEditorNotFoundError("成片导出任务不存在")
        if row.status not in TERMINAL:
            raise AssetError("进行中的导出任务不能删除", code="task_active", status=409)
        if row.revision != expected:
            current = task_out(row)
            raise RevisionConflictError(
                expected, row.revision, current.model_dump(mode="json", by_alias=True)
            )
        return row

    async def _reject_active_uses(self, project, asset):
        active = await self.session.scalars(
            select(VideoEditorTask).where(
                VideoEditorTask.project_id == project,
                VideoEditorTask.owner_user_id == self.owner,
                VideoEditorTask.status.in_(("queued", "running")),
            )
        )
        if any(
            task.request_payload.get("assetId") == asset or uses_file(task.snapshot_document, asset)
            for task in active
        ):
            raise VideoEditorValidationError("成片仍被进行中的任务引用", code="asset_in_use")

    async def remove(self, project, task, expected):
        await VideoEditorProjects(self.session, self.owner).row(project)
        output = (await self._task(project, task, expected)).output_asset_id

        async def apply():
            row = await self._task(project, task, expected)
            if row.output_asset_id != output:
                raise AssetError("成片原件已变化，请重试删除", code="revision_conflict", status=409)
            if output is not None:
                await self._reject_active_uses(project, output)
            await self.session.delete(row)
            await self.session.execute(
                delete(VideoRenderDispatch).where(
                    VideoRenderDispatch.task_id == task, VideoRenderDispatch.settled.is_(True)
                )
            )

        if output is not None:
            await MediaEdits(self.request, self.session, self.owner).remove(
                project, output, render_id=task, remove_task=apply
            )
        else:
            await self.session.rollback()
            await self.session.execute(text("BEGIN IMMEDIATE"))
            await apply()
            await self.session.commit()
