"""Scopes for Visual portable snapshot metadata, originals and model labels."""

import hashlib
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from studio.contracts.asset_library.descriptions import (
    ID,
    LibraryAssetDescription,
    LibraryAssetQuery,
)
from studio.contracts.motion_compositor.motion_preview import DIGEST
from studio.contracts.motion_compositor.motion_snapshot import MotionArchiveManifest
from studio.contracts.thought_workshop.thought_archives import ArchiveFileKey
from studio.contracts.visual_workshop.visual_assistant import SOURCE

ASSETS = "/_internal/v1/visual-snapshot-assets"
MODELS = "/_internal/v1/visual-snapshot-models"
ASSET_PURPOSE = "visual.snapshot-assets.read"
MODEL_PURPOSE = "visual.snapshot-models.read"
MAX_QUERY_BYTES = 4 * 1024 * 1024


class SnapshotAssetQuery(LibraryAssetQuery):
    excluded_generated: list[str] = Field(max_length=10000)

    @field_validator("excluded_generated")
    @classmethod
    def canonical_exclusions(cls, values):
        return LibraryAssetQuery.canonical(values)

    def path(self, project_id):
        return f"{ASSETS}/{project_id}/metadata/{self.digest}"


class SnapshotAsset(LibraryAssetDescription):
    display_name: str
    folder_id: str | None


class SnapshotFolder(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str
    parent_id: str | None
    name: str


class SnapshotFiles(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    assets: list[SnapshotAsset]
    folders: list[SnapshotFolder]
    max_bytes: int = Field(ge=1, strict=True)
    max_files: int = Field(ge=1, strict=True)


class SnapshotModels(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    model_ids: list[str] = Field(max_length=10000)

    @field_validator("model_ids")
    @classmethod
    def canonical_models(cls, values):
        return LibraryAssetQuery.canonical(values)

    @property
    def digest(self):
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()

    @property
    def path(self):
        return f"{MODELS}/{self.digest}"


class ModelIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    provider_kind: str
    model_slug: str


def asset_target(method, path):
    if method == "POST":
        return re.fullmatch(rf"{ASSETS}/({ID})/(metadata|originals)/([a-f0-9]{{64}})", path)
    return None


def model_target(method, path):
    return method == "POST" and bool(re.fullmatch(rf"{MODELS}/[a-f0-9]{{64}}", path))


def snapshot_grant(grant):
    if grant.caller != "visual" or grant.source_method != "GET":
        return False
    source = re.fullmatch(rf"{SOURCE}/({ID})/snapshot", grant.source_path)
    if source is None:
        return False
    if (grant.purpose, grant.target_service) == (ASSET_PURPOSE, "assets"):
        target = asset_target(grant.target_method, grant.target_path)
        return bool(target and target[1] == source[1])
    return (grant.purpose, grant.target_service) == (MODEL_PURPOSE, "models") and model_target(
        grant.target_method, grant.target_path
    )


IMPORT = SOURCE + "/snapshot-imports"
ARCHIVE_PREFIX = "/_internal/v1/visual-archives"
ARCHIVE_PURPOSE = "visual.archive.stage"
ARCHIVE_DOMAIN = b"fpl-visual-archive-v1"
MODEL_RESOLVE = "/_internal/v1/visual-snapshot-model-resolution"
MODEL_RESOLVE_PURPOSE = "visual.snapshot-models.resolve"
MAX_LAYOUT_BYTES = 10 * 1024 * 1024


class SnapshotModelResolution(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    references: dict[str, ModelIdentity] = Field(max_length=10000)

    @property
    def digest(self):
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()

    @property
    def path(self):
        return f"{MODEL_RESOLVE}/{self.digest}"


class VisualArchiveFolder(SnapshotFolder):
    id: str = Field(pattern=rf"^{ID}$")
    parent_id: str | None = Field(default=None, pattern=rf"^{ID}$")
    name: str = Field(min_length=1, max_length=120)


class VisualArchiveManifest(MotionArchiveManifest):
    files: list[ArchiveFileKey] = Field(max_length=9998)
    folders: list[VisualArchiveFolder] = Field(max_length=10000)
    file_folders: list[str | None] = Field(max_length=9998)
    canvas_ordinals: list[int] = Field(max_length=9998)
    acceptance_ordinals: list[int] = Field(max_length=9998)

    @model_validator(mode="after")
    def validate_layout(self):
        known = set()
        for folder in self.folders:
            if folder.id in known or (
                folder.parent_id is not None and folder.parent_id not in known
            ):
                raise ValueError("视觉归档文件夹身份或顺序无效")
            known.add(folder.id)
        if len(self.file_folders) != len(self.files) or any(
            identity is not None and identity not in known for identity in self.file_folders
        ):
            raise ValueError("视觉归档素材文件夹无效")
        for ordinals in (self.canvas_ordinals, self.acceptance_ordinals):
            if ordinals != sorted(set(ordinals)) or any(
                not 0 <= ordinal < len(self.files) for ordinal in ordinals
            ):
                raise ValueError("视觉归档素材序号无效")
        return self


def archive_target(method, path):
    return method == "POST" and re.fullmatch(
        ARCHIVE_PREFIX + rf"/([a-f0-9]{{32}})/({DIGEST})/(files/[0-9]{{1,4}}|seal)/({DIGEST})",
        path,
    )


def resolution_target(method, path):
    return method == "POST" and re.fullmatch(rf"{MODEL_RESOLVE}/({DIGEST})", path)


def archive_grant(grant):
    if (grant.caller, grant.source_method, grant.source_path) != ("visual", "POST", IMPORT):
        return False
    if (grant.purpose, grant.target_service) == (ARCHIVE_PURPOSE, "assets"):
        return bool(archive_target(grant.target_method, grant.target_path))
    return (grant.purpose, grant.target_service) == (MODEL_RESOLVE_PURPOSE, "models") and bool(
        resolution_target(grant.target_method, grant.target_path)
    )
