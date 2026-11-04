"""One exact Motion preview document and its bounded Assets read scope."""

import hashlib
import re
from struct import Struct

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .library_assets import ID
from .motion_assets import SOURCE

PREFIX = "/_internal/v1/motion-preview"
INPUTS = "/_internal/v1/motion-preview-inputs"
PURPOSE = "motion.preview.render"
SIZE = Struct(">Q")
MAX_SCENE_BYTES = 16 * 1024 * 1024
MAX_SCOPE_BYTES = 48 * 1024
DIGEST = r"[0-9a-f]{64}"


def sha256(body):
    return hashlib.sha256(body).hexdigest()


class FrameFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern="^" + ID + "$")
    revision: int = Field(ge=0, strict=True)


class FrameScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    files: tuple[FrameFile, ...] = Field(max_length=200)

    @model_validator(mode="after")
    def canonical_ids(self):
        ids = [file.id for file in self.files]
        if ids != sorted(set(ids)):
            raise ValueError("渲染文件必须按标识排序且不得重复")
        return self

    @property
    def digest(self):
        return sha256(self.model_dump_json().encode())


class FrameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    frame: int = Field(ge=0, le=3600, strict=True)
    revision: int = Field(ge=0, strict=True)
    document: dict
    scope: FrameScope


def preview_target(method, path):
    return method == "POST" and re.fullmatch(rf"{PREFIX}/({ID})/({DIGEST})/({DIGEST})", path)


def motion_preview_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "motion",
        PURPOSE,
        "rendering",
        "GET",
    ):
        return False
    target = preview_target(grant.target_method, grant.target_path)
    return bool(target and grant.source_path == f"{SOURCE}/projects/{target[1]}/preview/frame")


def active_media(document, frame):
    return {
        layer.asset_id
        for layer in document.layers
        if layer.asset_id and layer.visible and layer.start_frame <= frame < layer.end_frame
    }
