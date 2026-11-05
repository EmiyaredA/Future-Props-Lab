"""Validate the owned project range before the transcription adapter performs I/O."""

from studio.apps.audio_annotation.models import AudioAnnotationProject
from studio.apps.audio_annotation.projects import MIN_SEGMENT_MS
from studio.apps.audio_annotation.sources import AudioAnnotationError


async def transcribe_project(session, project_id, start_ms, end_ms):
    project = await session.get(AudioAnnotationProject, project_id)
    if project is None:
        raise AudioAnnotationError("标注任务不存在", code="not_found", status=404)
    if end_ms - start_ms < MIN_SEGMENT_MS:
        raise AudioAnnotationError("片段长度不能小于 100 毫秒", code="segment_too_short")
    if start_ms < 0 or end_ms > project.duration_ms:
        raise AudioAnnotationError("片段超出音频时长", code="segment_out_of_range")
    return project.owner_user_id
