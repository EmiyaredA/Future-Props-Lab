"""Digest-bound streaming transport for one Galgame project upload batch."""

import hashlib
import re

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .galgame_assets import SOURCE, GalgameAssetFile
from .library_assets import ID
from .model_outputs import ModelOutputDescription

PREFIX = "/_internal/v1/galgame-project-uploads"
PURPOSE = "galgame.project-assets.upload"
MAX_MANIFEST = 512 * 1024
MAX_FILES = 500


class UploadMember(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    filename: str
    mime_type: str
    byte_size: int
    content_sha256: str

    @model_validator(mode="after")
    def valid_file(self):
        ModelOutputDescription(**self.model_dump())
        return self


class UploadManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    files: tuple[UploadMember, ...] = Field(min_length=1, max_length=MAX_FILES)

    @property
    def raw(self):
        return self.model_dump_json().encode()

    @property
    def digest(self):
        return hashlib.sha256(self.raw).hexdigest()

    @property
    def total_bytes(self):
        return 8 + len(self.raw) + sum(file.byte_size for file in self.files)


class UploadReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[GalgameAssetFile] = Field(min_length=1, max_length=MAX_FILES)


def upload_target(method, path):
    if method == "POST":
        return re.fullmatch(
            rf"{PREFIX}/({ID})/([0-9a-f]{{32}})/(single|batch)/([0-9a-f]{{64}})", path
        )
    return None


def upload_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "galgame",
        PURPOSE,
        "assets",
        "POST",
    ):
        return False
    target = upload_target(grant.target_method, grant.target_path)
    if target is None:
        return False
    project, _, mode, _ = target.groups()
    suffix = "/batch" if mode == "batch" else ""
    return grant.source_path == f"{SOURCE}/{project}/assets{suffix}"
