"""Exact, bounded Model requests for a Visual node acceptance run."""

import re

from pydantic import BaseModel, ConfigDict, Field, model_validator

from studio.contracts.asset_library.descriptions import ID
from studio.contracts.motion_compositor.motion_preview import DIGEST, sha256

MODEL_PLAN = "/_internal/v1/visual-review/model-plan"
MODEL_RUN = "/_internal/v1/visual-review/model-runs"
PLAN_PURPOSE = "visual.review-model-plan"
RUN_PURPOSE = "visual.review-model-run"
MAX_REVIEW_IMAGES = 12 + 2 * 40
MAX_IMAGE_BASE64 = 2 * 1024**2
MAX_MODEL_REQUEST = MAX_REVIEW_IMAGES * MAX_IMAGE_BASE64 + 2 * 1024**2


def start_source(method, path):
    return method == "POST" and re.fullmatch(
        rf"/v1/visual-workshop/projects/({ID})/nodes/({ID})/acceptance/runs", path
    )


class ReviewModelPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    model_id: str
    signature: str = Field(pattern=rf"^{DIGEST}$")
    model_slug: str
    provider_kind: str


class ReviewImage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=rf"^{ID}$")
    asset_id: str = Field(pattern=rf"^{ID}$")
    source_asset_id: str = Field(pattern=rf"^{ID}$")
    position_ms: int | None = Field(default=None, ge=0)
    jpeg_base64: str = Field(min_length=4, max_length=MAX_IMAGE_BASE64)

    def evidence(self):
        return self.model_dump(exclude={"jpeg_base64"})


class ReviewModelRun(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    project_id: str = Field(pattern=rf"^{ID}$")
    run_id: str = Field(pattern=rf"^{ID}$")
    model: ReviewModelPlan
    criteria: list[dict] = Field(min_length=1, max_length=40)
    evidence: list[ReviewImage] = Field(min_length=1, max_length=MAX_REVIEW_IMAGES)
    coverage: str = Field(max_length=16000)
    prompt: str = Field(max_length=20000)

    @model_validator(mode="after")
    def exact_evidence(self):
        ids = [row.id for row in self.evidence]
        criteria = [row.get("id") for row in self.criteria]
        if (
            len(set(ids)) != len(ids)
            or any(not isinstance(identity, str) or not identity for identity in criteria)
            or len(set(criteria)) != len(criteria)
            or any(row.get("method") != "ai" for row in self.criteria)
        ):
            raise ValueError("视觉模型验收条目和证据标识无效")
        return self

    @property
    def digest(self):
        return sha256(self.model_dump_json().encode())

    @property
    def path(self):
        return f"{MODEL_RUN}/{self.project_id}/{self.run_id}/{self.digest}"


def model_target(method, path):
    if method == "GET" and path == MODEL_PLAN:
        return True
    return method == "POST" and re.fullmatch(rf"{MODEL_RUN}/({ID})/({ID})/({DIGEST})", path)


def review_model_grant(grant):
    if (grant.caller, grant.target_service) != ("visual", "models"):
        return False
    source = start_source(grant.source_method, grant.source_path)
    if not source:
        return False
    if grant.purpose == PLAN_PURPOSE:
        return (grant.target_method, grant.target_path) == ("GET", MODEL_PLAN)
    target = model_target(grant.target_method, grant.target_path)
    return bool(grant.purpose == RUN_PURPOSE and target and target[1] == source[1])
