"""Exact original and provider-attempt scopes for Galgame voice recognition."""

import base64
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from studio.contracts.asset_library.descriptions import ID
from studio.contracts.galgame_workshop.galgame_assets import SOURCE
from studio.contracts.motion_compositor.motion_preview import DIGEST, sha256
from studio.runtime.files.signed_payloads import ModelOutputDescription

CATALOG = "/_internal/v1/galgame-asr-catalog"
ORIGINAL = "/_internal/v1/galgame-asr-originals"
EXECUTION = "/_internal/v1/galgame-asr-attempts"
PURPOSE_CATALOG = "galgame.transcription-model.resolve"
PURPOSE_ORIGINAL = "galgame.transcription-original.read"
PURPOSE_EXECUTION = "galgame.transcription.execute"
DESCRIPTION_HEADER = "X-Fpl-Galgame-Asr-Input"
ORIGINAL_HEADER = "X-Fpl-Galgame-Asr-Original"
MAX_BYTES = 100 * 1024 * 1024


class AsrCatalogEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    provider_id: str = Field(pattern=rf"^{ID}$")
    provider_name: str
    model_slug: str
    byte_limit: int = Field(gt=0, le=MAX_BYTES)


class AsrInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    project_id: str = Field(pattern=rf"^{ID}$")
    task_id: str = Field(pattern=rf"^{ID}$")
    asset_id: str = Field(pattern=rf"^{ID}$")
    provider_id: str = Field(pattern=rf"^{ID}$")
    model_id: str = Field(pattern=rf"^{ID}$")
    model_slug: str = Field(min_length=1, max_length=160)
    language: Literal["auto", "zh", "ja"]
    filename: str
    mime_type: str
    byte_size: int = Field(ge=1, le=MAX_BYTES, strict=True)
    content_sha256: str

    @model_validator(mode="after")
    def exact_original(self):
        ModelOutputDescription(self.filename, self.mime_type, self.byte_size, self.content_sha256)
        return self

    @property
    def path(self):
        digest = sha256(self.model_dump_json().encode())
        return f"{EXECUTION}/{self.project_id}/{self.task_id}/{digest}"

    def header(self):
        return base64.urlsafe_b64encode(self.model_dump_json().encode()).decode("ascii")

    @classmethod
    def from_header(cls, value):
        if not 1 <= len(value) <= 4096:
            raise ValueError("Galgame 语音识别输入描述无效")
        raw = base64.b64decode(value, altchars=b"-_", validate=True)
        return cls.model_validate_json(raw)


class TranscriptSegment(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    speaker: str
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)
    text: str


class AsrOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    status: Literal["running", "completed", "failed", "unknown"]
    text: str | None = None
    segments: list[TranscriptSegment] = Field(default_factory=list)
    error: str | None = None


def source_path(project_id):
    return f"{SOURCE}/{project_id}/assets/asr/transcriptions"


def catalog_target(method, path):
    return method == "GET" and re.fullmatch(rf"{CATALOG}/({ID})", path)


def original_target(method, path):
    return method == "GET" and re.fullmatch(
        rf"{ORIGINAL}/({ID})/({ID})/(0|[1-9][0-9]{{0,17}})", path
    )


def execution_target(method, path):
    return method in {"POST", "GET"} and re.fullmatch(
        rf"{EXECUTION}/({ID})/({ID})/({DIGEST})", path
    )


def asr_job_grant(grant):
    if grant.caller != "galgame" or grant.source_method != "POST":
        return False
    target = (grant.target_service, grant.purpose)
    if target == ("models", PURPOSE_CATALOG):
        return bool(
            re.fullmatch(rf"{SOURCE}/{ID}/assets/asr/transcriptions", grant.source_path)
            and catalog_target(grant.target_method, grant.target_path)
        )
    if target == ("assets", PURPOSE_ORIGINAL):
        scoped = original_target(grant.target_method, grant.target_path)
    elif target == ("models", PURPOSE_EXECUTION):
        scoped = execution_target(grant.target_method, grant.target_path)
    else:
        return False
    return bool(scoped and grant.source_path == source_path(scoped[1]))
