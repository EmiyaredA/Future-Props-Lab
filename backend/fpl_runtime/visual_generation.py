"""Grant Visual only credential-free model metadata for its generation requests."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery
from .motion_preview import DIGEST, FrameFile, FrameScope, sha256
from .visual_assistant import approval_source

MODEL = "/_internal/v1/visual-generation/models"
MODEL_PURPOSE = "visual.generation-model.read"


class ModelSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    model_id: str = Field(pattern=rf"^{ID}$")
    kind: Literal["image", "audio", "video"]
    audio_mode: Literal["music", "sfx"] | None = None

    @model_validator(mode="after")
    def valid_mode(self):
        if (self.kind == "audio") != (self.audio_mode is not None):
            raise ValueError("生成模型类型和音频模式不匹配")
        return self

    @property
    def digest(self):
        return sha256(self.model_dump_json().encode())

    @property
    def path(self):
        return f"{MODEL}/{self.digest}"


class VisualModelChoice(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    model_id: str
    provider_id: str
    provider_kind: str
    provider_name: str
    model_slug: str
    temporary_upload_configured: bool


def generation_source(method, path):
    return method == "POST" and re.fullmatch(
        rf"/v1/visual-workshop/projects/({ID})/generation-(tasks|batches)", path
    )


def generation_admission_source(method, path):
    return generation_source(method, path) or approval_source(method, path)


def model_target(method, path):
    return method == "POST" and re.fullmatch(rf"{MODEL}/({DIGEST})", path)


def visual_generation_model_grant(grant):
    return bool(
        (grant.caller, grant.purpose, grant.target_service) == ("visual", MODEL_PURPOSE, "models")
        and generation_admission_source(grant.source_method, grant.source_path)
        and model_target(grant.target_method, grant.target_path)
    )


ASSETS = "/_internal/v1/visual-generation/assets"
ASSET_PURPOSE = "visual.generation-assets.read"
MAX_REFERENCES = 64


class GenerationAssetQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=MAX_REFERENCES)

    def path(self, project, task):
        return f"{ASSETS}/{project}/{task}/metadata/{self.digest}"


class GenerationFileScope(FrameScope):
    files: tuple[FrameFile, ...] = Field(min_length=1, max_length=MAX_REFERENCES)

    def path(self, project, task):
        return f"{ASSETS}/{project}/{task}/originals/{self.digest}"


class GenerationAssets(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    items: list[LibraryAssetDescription] = Field(max_length=MAX_REFERENCES)
    max_video_bytes: int = Field(ge=1, strict=True)


def generation_asset_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{ASSETS}/({ID})/({ID})/(metadata|originals)/({DIGEST})", path
    )


def visual_generation_asset_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service) != ("visual", ASSET_PURPOSE, "assets"):
        return False
    source = generation_admission_source(grant.source_method, grant.source_path)
    target = generation_asset_target(grant.target_method, grant.target_path)
    return bool(source and target and source[1] == target[1])


PLANS = "/_internal/v1/visual-generation/plans"
PLAN_PURPOSE = "visual.generation-plan.prepare"
MAX_PLAN_BYTES = 2 * 1024**2
ORIGINALS_HEADER = "X-Fpl-Generation-Originals"
PEER_DOMAIN = b"fpl-visual-model-generation-v1"


def plan_target(method, path):
    return method == "POST" and re.fullmatch(rf"{PLANS}/({ID})/({ID})/({DIGEST})", path)


def visual_generation_plan_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service) != ("visual", PLAN_PURPOSE, "models"):
        return False
    source = generation_admission_source(grant.source_method, grant.source_path)
    target = plan_target(grant.target_method, grant.target_path)
    return bool(source and target and source[1] == target[1])


def settlement_path(project, identity, digest, decision):
    return f"{PLANS}/{project}/{identity}/{digest}/{decision}"
