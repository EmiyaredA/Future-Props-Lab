"""Body-bound execution of one Annotation segment by the Models owner."""

import base64
import hashlib
import re
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .library_assets import ID

SEGMENT = r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}"
PREFIX = "/_internal/v1/annotation-transcription"
PURPOSE = "annotation.transcription.execute"
HEADER = "X-Fpl-Annotation-Input"
MAX_BYTES = 100 * 1024 * 1024
WAV_TYPES = frozenset({"audio/wav", "audio/x-wav", "application/octet-stream"})


class SegmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    project_id: str = Field(pattern=rf"^{ID}$")
    segment_id: str = Field(pattern=rf"^{SEGMENT}$")
    model_id: str = Field(min_length=1, max_length=36)
    start_ms: int = Field(ge=0, le=3600000, strict=True)
    end_ms: int = Field(gt=0, le=3600000, strict=True)
    language_tag: str | None = Field(max_length=35)
    target_language_tag: str | None = Field(max_length=35)
    attempt_id: UUID
    byte_size: int = Field(ge=1, le=MAX_BYTES, strict=True)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def valid_interval(self):
        if self.end_ms - self.start_ms < 100:
            raise ValueError("片段长度不能小于 100 毫秒")
        return self

    def header(self):
        return base64.urlsafe_b64encode(self.model_dump_json().encode()).decode()

    @classmethod
    def from_header(cls, value):
        if not isinstance(value, str) or not 1 <= len(value) <= 4096:
            raise ValueError("识别输入描述超限")
        return cls.model_validate_json(base64.b64decode(value, altchars=b"-_", validate=True))

    @property
    def path(self):
        checksum = hashlib.sha256(self.model_dump_json().encode()).hexdigest()
        return f"{PREFIX}/{self.project_id}/{self.segment_id}/{checksum}"


class SegmentResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    text: str = Field(max_length=20000)
    model_id: str
    requested_language: str | None
    resolved_language: str
    requested_target_language: str | None
    resolved_target_language: str | None
    log_id: str


def target(method, path):
    if method == "POST":
        return re.fullmatch(rf"{PREFIX}/({ID})/({SEGMENT})/[a-f0-9]{{64}}", path)
    return None


def segment_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "annotation",
        PURPOSE,
        "models",
        "POST",
    ):
        return False
    match = target(grant.target_method, grant.target_path)
    if match is None:
        return False
    project, segment = match.groups()
    source = "/v1/audio-annotation/projects/" + project
    return grant.source_path in {
        source + "/segment-transcriptions",
        source + "/segments/" + segment + "/transcribe-saved",
    }
