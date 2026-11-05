"""Exact, resumable transfer descriptions for previously rendered media."""

import re
from datetime import datetime
from typing import Literal
from uuid import NAMESPACE_URL, uuid5

from pydantic import BaseModel, ConfigDict, Field, model_validator

from studio.contracts.management.migration_batches import (
    BatchReceipt,
    MigrationBatch,
    MigrationPage,
)
from studio.contracts.management.project_history import Identifier
from studio.contracts.media_rendering.output_formats import OUTPUT_NAMES

MOTION_DATASET = "rendering.motion-exports"
MOTION_PREFIX = "/v1/migration/rendering/motion-exports"
VIDEO_DATASET = "rendering.video-derivatives"
VIDEO_PREFIX = "/v1/migration/rendering/video-derivatives"
MAX_ARTIFACT_BYTES = 8 * 1024**3
SHA = r"^[a-f0-9]{64}$"


def motion_render_id(task_id):
    return uuid5(NAMESPACE_URL, "fpl:rendering:legacy-motion:" + task_id).hex


def video_media_id(asset_id):
    return str(uuid5(NAMESPACE_URL, "fpl:rendering:legacy-video:" + asset_id))


class RenderArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    key: Literal["mp4", "mov4444", "png-sequence", "proxy", "thumbnail", "waveform"]
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0, le=MAX_ARTIFACT_BYTES, strict=True)
    sha256: str = Field(pattern=SHA)

    @model_validator(mode="after")
    def check_filename(self):
        name = self.filename
        if (
            name in {".", ".."}
            or "/" in name
            or "\\" in name
            or any(ord(char) < 32 for char in name)
        ):
            raise ValueError("历史渲染文件名无效")
        return self


class MotionRenderHistory(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: Identifier
    project_id: Identifier
    created_at: datetime
    files: tuple[RenderArtifact, ...] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def validate_outputs(self):
        keys = [file.key for file in self.files]
        if keys != sorted(set(keys)) or any(
            OUTPUT_NAMES.get(file.key) != file.filename for file in self.files
        ):
            raise ValueError("历史特效成片与原格式不符")
        return self


class MotionRenderBatch(MigrationBatch[MotionRenderHistory]):
    dataset: Literal["rendering.motion-exports"]


MotionRenderPage = MigrationPage[MotionRenderBatch]


class VideoDerivativeHistory(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: Identifier
    project_id: Identifier
    created_at: datetime
    source_sha256: str = Field(pattern=SHA)
    probe: dict
    files: tuple[RenderArtifact, ...] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def validate_outputs(self):
        keys = [file.key for file in self.files]
        variants = {
            "proxy": r"\.(?:mp4|webm|wav)$",
            "thumbnail": r"\.png$",
            "waveform": r"\.png$",
        }
        if keys != sorted(set(keys)) or any(
            file.key not in variants or not re.search(variants[file.key], file.filename)
            for file in self.files
        ):
            raise ValueError("历史剪辑派生文件类型无效")
        return self


class VideoDerivativeBatch(MigrationBatch[VideoDerivativeHistory]):
    dataset: Literal["rendering.video-derivatives"]


VideoDerivativePage = MigrationPage[VideoDerivativeBatch]


def file_receipt(plan, owner, dataset, identity, file):
    import hashlib

    return BatchReceipt(
        run_id=plan.run_id,
        owner_id=owner,
        dataset=dataset + "-files",
        batch_id=uuid5(plan.run_id, f"{dataset}/{owner}/{identity}/{file.key}"),
        sha256=hashlib.sha256(file.model_dump_json().encode()).hexdigest(),
        record_count=1,
    )
