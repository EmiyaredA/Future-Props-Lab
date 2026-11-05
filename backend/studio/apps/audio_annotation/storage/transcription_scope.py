"""Return detached owned range metadata and release SQL before external work."""

from studio.apps.audio_annotation.models import AudioAnnotationProject
from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.apps.audio_annotation.use_cases.transcribe_segment import TranscriptionScope


class TranscriptionProjects:
    def __init__(self, session):
        self.session = session

    async def load(self, project_id):
        try:
            project = await self.session.get(AudioAnnotationProject, project_id)
            if project is None:
                raise AudioAnnotationError("标注任务不存在", code="not_found", status=404)
            return TranscriptionScope(project.owner_user_id, project.duration_ms)
        finally:
            await self.session.rollback()
