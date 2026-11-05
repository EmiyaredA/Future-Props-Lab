"""Read an account-owned timeline using the shared compatibility normalization."""

from copy import deepcopy

from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.media_rendering.timeline_document import normalize_legacy_edge_transitions
from studio.apps.video_editor.errors import VideoEditorNotFoundError
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.schemas import VideoEditorTimelineOut
from studio.apps.video_editor.storage.models import VideoEditorTimeline
from studio.runtime.time import iso_utc


class VideoTimelineRead:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id

    async def row(self, project_id: str) -> VideoEditorTimeline:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)
        row = await self.session.get(VideoEditorTimeline, project_id)
        if row is None:
            raise VideoEditorNotFoundError("时间轴不存在")
        return row

    @staticmethod
    def out(row: VideoEditorTimeline) -> VideoEditorTimelineOut:
        document = normalize_legacy_edge_transitions(deepcopy(row.document or {}))
        return VideoEditorTimelineOut(
            projectId=row.project_id,
            revision=row.revision,
            document=document,
            updatedAt=iso_utc(row.updated_at),
        )

    async def get(self, project_id: str) -> VideoEditorTimelineOut:
        return self.out(await self.row(project_id))
