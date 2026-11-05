"""Render detached saved documents without storage or clock access."""

import json

from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.runtime.time import iso_utc


def timestamp(ms):
    seconds, ms = divmod(ms, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02},{ms:03}"


def render_document(project, document, format, *, exported_at):
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
        return ("\ufeff" + "\n".join(lines)).encode(), "application/x-subrip", project.id + ".srt"
    payload = {
        "kind": "future-props-audio-annotation",
        "schema_version": "1.0",
        "exported_at": iso_utc(exported_at),
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
        project.id + ".annotation.json",
    )
