"""Only the Annotation import operation may read a Models task and save its original."""

import re
from pathlib import Path

from pydantic import BaseModel, Field, JsonValue

from studio.contracts.asset_library.descriptions import ID
from studio.runtime.files.signed_payloads import ModelOutputDescription

SOURCE = "/v1/audio-annotation/transcription-imports"
TASKS = "/v1/model-test/transcription-tasks"
UPLOADS = "/_internal/v1/annotation-task-originals"
READ = "annotation.transcription-task.read"
WRITE = "annotation.transcription-task.save"
MAX_BYTES = 100 * 1024 * 1024


class TaskAudio(BaseModel):
    source_asset_id: str | None
    filename: str = Field(max_length=255)
    mime_type: str = Field(max_length=255)
    byte_size: int = Field(gt=0, le=MAX_BYTES)
    available: bool


class TranscriptionTask(BaseModel):
    id: str
    status: str
    source: TaskAudio
    result_text: str | None
    result_segments: list[dict[str, JsonValue]]


class AnnotationTaskOriginal(ModelOutputDescription):
    def __post_init__(self):
        super().__post_init__()
        if (
            Path(self.filename).suffix.lower() not in {".mp3", ".wav", ".m4a", ".ogg"}
            or not self.mime_type.startswith("audio/")
            or self.byte_size > MAX_BYTES
        ):
            raise ValueError("识别原件必须是可导入的音频")


def upload_target(path):
    return bool(re.fullmatch(rf"{UPLOADS}/{ID}/[a-f0-9]{{64}}", path))


def task_read_grant(grant):
    return (
        (grant.caller, grant.source_method, grant.source_path, grant.purpose)
        == ("annotation", "POST", SOURCE, READ)
        and (grant.target_service, grant.target_method) == ("models", "GET")
        and bool(re.fullmatch(rf"{TASKS}/{ID}(?:/input-content)?", grant.target_path))
    )


def task_upload_grant(grant):
    return (
        (grant.caller, grant.source_method, grant.source_path, grant.purpose)
        == ("annotation", "POST", SOURCE, WRITE)
        and (grant.target_service, grant.target_method) == ("assets", "POST")
        and upload_target(grant.target_path)
    )
