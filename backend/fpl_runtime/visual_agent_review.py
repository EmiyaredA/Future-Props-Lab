"""Wire contracts for one Visual review on a fixed native Agent connection."""

import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

from .agent_ids import AgentId
from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery
from .motion_preview import DIGEST, sha256
from .visual_agent_report import AgentReport
from .visual_review import start_source
from .visual_samples import MAX_FRAME_BYTES

JOBS = "/_internal/v1/visual-agent-reviews/jobs"
SOURCES = "/_internal/v1/visual-agent-reviews/assets"
STATUS = "/_internal/v1/visual-agent-reviews/status"
RESULTS = "/_internal/v1/visual-agent-reviews/results"
JOB_PURPOSE = "visual.agent-review.submit"
ASSET_PURPOSE = "visual.agent-review.media"
STATUS_PURPOSE = "visual.agent-review.authorize"
RESULT_PURPOSE = "visual.agent-review.evidence"
OPERATION = "visual.acceptance.execute"
MAX_FILES = 41 + 12 + 2 * 40
MAX_JOB_BYTES = 256 * 1024
MAX_EXTRA_FRAMES = 24
Identity = Annotated[str, Field(pattern=rf"^{ID}$")]


class ReviewAssetQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=MAX_FILES)

    def path(self, project, run):
        return f"{SOURCES}/{project}/{run}/describe/{self.digest}"


class ReviewSubject(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    asset_id: str = Field(pattern=rf"^{ID}$")
    kind: Literal["image", "video"]
    label: str = Field(max_length=1024)


class ReviewEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=rf"^{ID}$")
    asset_id: str = Field(pattern=rf"^{ID}$")
    source_asset_id: str = Field(pattern=rf"^{ID}$")
    position_ms: int | None = Field(ge=0)


class ReviewInstructions(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    criteria: list[dict[str, JsonValue]] = Field(min_length=1, max_length=40)
    prompt: str
    coverage: str
    output: dict[str, JsonValue]
    duration_ms: int = Field(gt=0, strict=True)


class AgentReviewPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    project_id: str = Field(pattern=rf"^{ID}$")
    run_id: str = Field(pattern=rf"^{ID}$")
    agent: AgentId
    connection_signature: str = Field(pattern=rf"^{DIGEST}$")
    deadline: datetime
    task: ReviewInstructions
    media: list[ReviewSubject] = Field(min_length=1, max_length=41)
    evidence: list[ReviewEvidence] = Field(min_length=1, max_length=92)
    files: list[LibraryAssetDescription] = Field(min_length=1, max_length=MAX_FILES)

    @model_validator(mode="after")
    def exact_inputs(self):
        ids = [file.id for file in self.files]
        media = {item.asset_id: item.kind for item in self.media}
        evidence = {item.id for item in self.evidence}
        types = {file.id: file.media_kind for file in self.files}
        if (
            self.deadline.tzinfo is not None
            or ids != sorted(set(ids))
            or len(media) != len(self.media)
            or len(evidence) != len(self.evidence)
            or set(ids) != set(media) | {item.asset_id for item in self.evidence}
            or any(types[identity] != kind for identity, kind in media.items())
            or any(file.byte_size <= 0 for file in self.files)
            or any(
                types[item.asset_id] != "image" or item.source_asset_id not in media
                for item in self.evidence
            )
        ):
            raise ValueError("验收任务素材与证据清单不一致")
        return self

    @property
    def digest(self):
        return sha256(self.model_dump_json().encode())

    @property
    def path(self):
        return f"{JOBS}/{self.project_id}/{self.run_id}/{self.digest}"

    @property
    def media_path(self):
        return f"{SOURCES}/{self.project_id}/{self.run_id}/originals/{self.digest}"

    def frame_path(self, frame):
        return f"{RESULTS}/{self.project_id}/{self.run_id}/{self.digest}/{frame.id}/{frame.sha256}"

    @property
    def status_path(self):
        return f"{STATUS}/{self.project_id}/{self.run_id}/{self.digest}"


class ExtraReviewFrame(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=rf"^{ID}$")
    source_asset_id: str = Field(pattern=rf"^{ID}$")
    position_ms: int = Field(ge=0, strict=True)
    sha256: str = Field(pattern=rf"^{DIGEST}$")
    byte_size: int = Field(ge=1, le=MAX_FRAME_BYTES, strict=True)


class AgentReviewReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    report: AgentReport
    frames: list[ExtraReviewFrame] = Field(max_length=MAX_EXTRA_FRAMES)
    read_ids: list[Identity] = Field(max_length=92 + MAX_EXTRA_FRAMES)

    @model_validator(mode="after")
    def exact_ids(self):
        frames = [frame.id for frame in self.frames]
        if self.read_ids != sorted(set(self.read_ids)) or len(frames) != len(set(frames)):
            raise ValueError("验收回执中的证据标识重复")
        return self


def job_target(method, path):
    return method == "POST" and re.fullmatch(rf"{JOBS}/({ID})/({ID})/({DIGEST})", path)


def asset_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{SOURCES}/({ID})/({ID})/(describe|originals)/({DIGEST})", path
    )


def status_target(method, path):
    return method == "GET" and re.fullmatch(rf"{STATUS}/({ID})/({ID})/({DIGEST})", path)


def frame_target(method, path):
    return method == "GET" and re.fullmatch(
        rf"{RESULTS}/({ID})/({ID})/({DIGEST})/({ID})/({DIGEST})", path
    )


def agent_review_grant(grant):
    source = start_source(grant.source_method, grant.source_path)
    if grant.caller == "visual" and source:
        if (grant.purpose, grant.target_service) == (JOB_PURPOSE, "agent-runtime"):
            target = job_target(grant.target_method, grant.target_path)
        elif (grant.purpose, grant.target_service) == (RESULT_PURPOSE, "agent-runtime"):
            target = frame_target(grant.target_method, grant.target_path)
        elif (grant.purpose, grant.target_service) == (ASSET_PURPOSE, "assets"):
            target = asset_target(grant.target_method, grant.target_path)
            if target and target[3] != "describe":
                return False
        else:
            return False
        return bool(target and target[1] == source[1])
    if grant.caller != "agent-runtime":
        return False
    job = job_target(grant.source_method, grant.source_path)
    if not job:
        return False
    if (grant.purpose, grant.target_service) == (ASSET_PURPOSE, "assets"):
        target = asset_target(grant.target_method, grant.target_path)
        return bool(
            target
            and target[3] == "originals"
            and (target[1], target[2], target[4]) == job.groups()
        )
    if (grant.purpose, grant.target_service) == (STATUS_PURPOSE, "visual"):
        target = status_target(grant.target_method, grant.target_path)
        return bool(target and target.groups() == job.groups())
    return False
