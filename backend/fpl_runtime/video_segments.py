"""Private batch publication and exact task-scoped download for Video segments."""

import hashlib
import re
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .library_assets import ID
from .model_outputs import ModelOutputDescription
from .video_assets import SOURCE, VideoAsset

OUTPUTS = "/_internal/v1/video-segment-outputs"
BUNDLES = "/_internal/v1/video-segment-bundles"
PURPOSE = "video.segment-bundle.read"
MAX_MANIFEST_BYTES = 256 * 1024


class SegmentBatchManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    files: tuple[ModelOutputDescription, ...] = Field(min_length=1, max_length=100)

    @field_validator("files")
    @classmethod
    def verify_mp4(cls, files):
        if any(
            file.mime_type != "video/mp4" or not file.filename.endswith(".mp4") for file in files
        ):
            raise ValueError("分段导出仅包含 MP4 文件")
        return files

    @property
    def encoded(self):
        return self.model_dump_json().encode()

    @property
    def digest(self):
        return hashlib.sha256(self.encoded).hexdigest()

    @property
    def byte_size(self):
        return sum(item.byte_size for item in self.files)


class PublishedSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asset: VideoAsset
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


def segment_receipt_id(task_id):
    canonical = str(UUID(task_id))
    if canonical != task_id:
        raise ValueError("invalid segment task id")
    return uuid5(NAMESPACE_URL, "fpl:video:segment:" + canonical).hex


def bundle_target(method, path):
    return method == "GET" and re.fullmatch(rf"{BUNDLES}/({ID})/({ID})", path)


def bundle_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "video",
        PURPOSE,
        "assets",
        "GET",
    ):
        return False
    target = bundle_target(grant.target_method, grant.target_path)
    return bool(
        target
        and grant.source_path
        == f"{SOURCE}/projects/{target[1]}/segment-exports/{target[2]}/download"
    )
