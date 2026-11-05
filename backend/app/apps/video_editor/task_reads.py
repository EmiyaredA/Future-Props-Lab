"""Read Video tasks through their owning project without opening any media files."""

from sqlalchemy import select

from app.runtime.time import iso_utc

from .errors import VideoEditorNotFoundError
from .models import VideoEditorTask
from .projects import VideoEditorProjects
from .schemas import VideoEditorTaskListOut, VideoEditorTaskOut


def task_out(row: VideoEditorTask) -> VideoEditorTaskOut:
    return VideoEditorTaskOut(
        id=row.id,
        projectId=row.project_id,
        requestId=row.request_id,
        kind=row.kind,
        status=row.status,
        progress=row.progress,
        outputAssetId=row.output_asset_id,
        error=row.error,
        resultDetail=row.result_detail or {},
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        updatedAt=iso_utc(row.updated_at),
    )


class VideoTaskReads:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner

    async def query(self, project_id, kind):
        await VideoEditorProjects(self.session, self.owner).row(project_id)
        query = select(VideoEditorTask).where(
            VideoEditorTask.project_id == project_id,
            VideoEditorTask.owner_user_id == self.owner,
        )
        return query.where(VideoEditorTask.kind == kind) if kind else query

    async def list(self, project_id, kind):
        query = await self.query(project_id, kind)
        rows = await self.session.scalars(query.order_by(VideoEditorTask.created_at.desc()))
        return VideoEditorTaskListOut(items=[task_out(row) for row in rows])

    async def get(self, project_id, task_id, *, kind=None, missing):
        query = await self.query(project_id, kind)
        row = await self.session.scalar(query.where(VideoEditorTask.id == task_id))
        if row is None:
            raise VideoEditorNotFoundError(missing)
        return task_out(row)
