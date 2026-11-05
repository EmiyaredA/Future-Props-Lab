"""Project-scoped frame sampling and evidence publication contracts for Visual."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery
from .motion_preview import DIGEST, FrameFile, FrameScope, sha256
from .visual_review import start_source

ASSETS = "/_internal/v1/visual-sample-assets"
RENDER = "/_internal/v1/visual-samples"
ASSET_PURPOSE = "visual.sample-original.read"
RENDER_PURPOSE = "visual.sample-frames.render"
INPUT_HEADER = "X-Fpl-Sample-Original"
FRAMES_HEADER = "X-Fpl-Sample-Frames"
MEDIA_HEADER = "X-Fpl-Sample-Media"
MAX_FRAME_BYTES = 8 * 1024**2
MAX_REQUEST_BYTES = 16 * 1024


def sample_source(method, path):
    return method == "POST" and re.fullmatch(
        rf"/v1/visual-workshop/projects/({ID})/acceptance/runs/({ID})/samples", path
    )


class SampleAssetQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=1)
    media_kind: Literal["image", "video"] = "video"

    def path(self, project, run):
        kind = "image-metadata" if self.media_kind == "image" else "metadata"
        return f"{ASSETS}/{project}/{run}/{kind}/{self.digest}"


class SampleFileScope(FrameScope):
    files: tuple[FrameFile, ...] = Field(min_length=1, max_length=1)
    media_kind: Literal["image", "video"] = "video"

    def path(self, project, run):
        kind = "image-original" if self.media_kind == "image" else "original"
        return f"{ASSETS}/{project}/{run}/{kind}/{self.digest}"


class SamplePlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    source: LibraryAssetDescription
    positions_ms: list[int] = Field(default_factory=list, max_length=12)
    mode: Literal["interval", "review-output", "review-reference", "review-image"] = "interval"

    @model_validator(mode="after")
    def canonical_positions(self):
        kind = "image" if self.mode == "review-image" else "video"
        if self.source.media_kind != kind or self.source.byte_size <= 0:
            raise ValueError("验收取样媒体与模式不匹配")
        if (self.mode == "interval") != bool(self.positions_ms):
            raise ValueError("取样模式与时间范围不匹配")
        if self.positions_ms != sorted(set(self.positions_ms)) or any(
            position < 0 for position in self.positions_ms
        ):
            raise ValueError("验收取样时间必须有序且不能重复")
        return self

    @property
    def digest(self):
        return sha256(self.model_dump_json().encode())

    @property
    def scope(self):
        return SampleFileScope(
            files=(FrameFile(id=self.source.id, revision=self.source.revision),),
            media_kind=self.source.media_kind,
        )

    def path(self, project, run):
        suffix = "" if self.mode == "interval" else f"/{self.mode}"
        return f"{RENDER}/{project}/{run}/{self.digest}/{self.scope.digest}{suffix}"


class EvidenceFrame(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    position_ms: int = Field(ge=0, strict=True)
    byte_size: int = Field(ge=1, le=MAX_FRAME_BYTES, strict=True)
    content_sha256: str = Field(pattern=rf"^{DIGEST}$")

    @property
    def filename(self):
        return f"frame-{self.position_ms}ms.png"

    @property
    def mime_type(self):
        return "image/png"


class VisualEvidenceUpload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    project_id: str = Field(pattern=rf"^{ID}$")
    source_asset_id: str = Field(pattern=rf"^{ID}$")
    frames: list[EvidenceFrame] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def ordered_frames(self):
        positions = [item.position_ms for item in self.frames]
        if positions != sorted(set(positions)):
            raise ValueError("验收取样帧时间必须有序且不能重复")
        return self


def asset_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{ASSETS}/({ID})/({ID})/(metadata|original|image-metadata|image-original)/({DIGEST})",
        path,
    )


def render_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{RENDER}/({ID})/({ID})/({DIGEST})/({DIGEST})(?:/(review-output|review-reference|review-image))?",
        path,
    )


def sample_grant(grant):
    if grant.caller != "visual":
        return False
    source = sample_source(grant.source_method, grant.source_path)
    start = start_source(grant.source_method, grant.source_path)
    if not (source or start):
        return False
    if (grant.purpose, grant.target_service) == (ASSET_PURPOSE, "assets"):
        target = asset_target(grant.target_method, grant.target_path)
        if target and target[3].startswith("image-") and not start:
            return False
    elif (grant.purpose, grant.target_service) == (RENDER_PURPOSE, "rendering"):
        target = render_target(grant.target_method, grant.target_path)
        if target and bool(start) != bool(target[5]):
            return False
    else:
        return False
    return bool(
        target
        and (
            ((source[1], source[2]) == (target[1], target[2])) if source else start[1] == target[1]
        )
    )


def baseline_grant(grant):
    return bool(start_source(grant.source_method, grant.source_path) and sample_grant(grant))


def evidence_resource(run_id):
    return f"run-{run_id}"
