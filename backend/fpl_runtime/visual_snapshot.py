"""Scopes for Visual portable snapshot metadata, originals and model labels."""

import hashlib
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery
from .visual_assistant import SOURCE

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
