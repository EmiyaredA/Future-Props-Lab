"""Detach snapshots and release reads before delegated network work."""

from studio.apps.video_editor.timeline_read import VideoTimelineRead


class FrameTimelineRead(VideoTimelineRead):
    async def get(self, project_id):
        result = await super().get(project_id)
        await self.session.rollback()
        return result
