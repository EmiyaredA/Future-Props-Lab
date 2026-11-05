import asyncio
import json
import tempfile
from pathlib import Path

from app.capabilities.media_rendering.audio_clip import extract_wav
from studio.apps.audio_annotation.projects import AudioAnnotationError
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import iso_utc, utc_now


def timestamp(ms):
    seconds, ms = divmod(ms, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02},{ms:03}"


async def snapshot(projects, project_id, expected_revision):
    project = await projects.get(project_id)
    document = await projects.get_document(project_id)
    if document.revision != expected_revision:
        raise RevisionConflictError(expected_revision, document.revision, document.model_dump())
    return projects, project, document


async def export_document(projects, project_id, expected_revision, format):
    _, project, document = await snapshot(projects, project_id, expected_revision)
    segments = sorted(document.segments, key=lambda item: (item.start_ms, item.end_ms, item.id))
    if format == "srt":
        names = {speaker.id: speaker.name for speaker in document.speakers}
        lines = []
        for index, segment in enumerate(segments):
            if not segment.speaker_ids or not segment.text.strip():
                raise AudioAnnotationError(
                    "存在缺少说话人或内容的片段", code="incomplete_annotation"
                )
            speaker = "、".join(names[identity] for identity in segment.speaker_ids)
            lines.append(
                f"{index + 1}\n{timestamp(segment.start_ms)} --> {timestamp(segment.end_ms)}\n"
                f"{speaker}：{segment.text.strip()}\n"
            )
        return ("\ufeff" + "\n".join(lines)).encode(), "application/x-subrip", project_id + ".srt"
    payload = {
        "kind": "future-props-audio-annotation",
        "schema_version": "1.0",
        "exported_at": iso_utc(utc_now()),
        "project": {
            "title": project.title,
            "duration_ms": project.duration_ms,
            "source": {
                "asset_id": project.asset_id,
                "display_name": project.asset_display_name,
                "original_filename": project.original_filename,
                "mime_type": project.mime_type,
                "byte_size": project.byte_size,
            },
        },
        "speakers": [item.model_dump() for item in document.speakers],
        "custom_emotions": [item.model_dump() for item in document.custom_emotions],
        "segments": [item.model_dump() for item in segments],
    }
    return (
        json.dumps(payload, ensure_ascii=False).encode(),
        "application/json",
        project_id + ".annotation.json",
    )


async def clip(session, projects, project_id, segment_id, expected_revision, staging):
    projects, project, document = await snapshot(projects, project_id, expected_revision)
    segment = next((item for item in document.segments if item.id == segment_id), None)
    if segment is None:
        raise AudioAnnotationError("片段不存在", code="not_found", status=404)
    asset = await projects._asset(project.asset_id)
    async with projects.sources.open(asset) as source:
        return await clip_source(session, source, segment, staging)


async def clip_source(session, source, segment, staging):
    await session.rollback()
    with tempfile.TemporaryDirectory(prefix="annotation-clip-", dir=staging) as directory:
        target = Path(directory) / "clip.wav"
        try:
            await extract_wav(source, target, segment.start_ms, segment.end_ms)
        except (ValueError, FileNotFoundError, TimeoutError) as exc:
            raise AudioAnnotationError(
                "片段裁切失败，请检查媒体运行环境", code="clip_failed", status=422
            ) from exc
        return await asyncio.to_thread(target.read_bytes), segment


class ClipInput:
    content_type = "audio/wav"
    filename = "segment.wav"

    def __init__(self, content):
        self.content = content
        self.offset = 0

    async def read(self, size=-1):
        data = (
            self.content[self.offset :]
            if size < 0
            else self.content[self.offset : self.offset + size]
        )
        self.offset += len(data)
        return data

    async def close(self):
        self.content = b""


async def transcribe_saved(session, projects, project_id, segment_id, body, transcriber, staging):
    content, segment = await clip(
        session, projects, project_id, segment_id, body.expected_revision, staging
    )
    upload = ClipInput(content)
    try:
        return await transcriber(
            project_id,
            upload=upload,
            model_id=body.model_id,
            segment_id=segment_id,
            start_ms=segment.start_ms,
            end_ms=segment.end_ms,
            language_tag=body.language,
            target_language_tag=body.target_language,
        )
    finally:
        await upload.close()
