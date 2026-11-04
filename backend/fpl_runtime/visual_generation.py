"""Grant Visual only credential-free model metadata for its generation requests."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .library_assets import ID
from .motion_preview import DIGEST, sha256

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


def model_target(method, path):
    return method == "POST" and re.fullmatch(rf"{MODEL}/({DIGEST})", path)


def visual_generation_model_grant(grant):
    return bool(
        (grant.caller, grant.purpose, grant.target_service) == ("visual", MODEL_PURPOSE, "models")
        and generation_source(grant.source_method, grant.source_path)
        and model_target(grant.target_method, grant.target_path)
    )
