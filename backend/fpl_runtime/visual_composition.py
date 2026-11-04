"""Exact project, batch, versioned originals and grid plan for Visual compositions."""

import re

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery
from .motion_preview import DIGEST, FrameFile, FrameScope, sha256

ASSETS = "/_internal/v1/visual-grid-assets"
RENDER = "/_internal/v1/visual-grid"
ASSET_PURPOSE = "visual.grid-assets.read"
RENDER_PURPOSE = "visual.grid.render"
INPUT_HEADER = "X-Fpl-Grid-Originals"
MAX_PLAN_BYTES = 24 * 1024
MAX_FILES = 9
MAX_IMAGE_BYTES = 30 * 1024**2
MAX_BYTES = MAX_FILES * MAX_IMAGE_BYTES


def create_source(project):
    return f"/v1/visual-workshop/projects/{project}/image-compositions"


def retry_source(batch):
    return f"/v1/visual-workshop/generation-batches/{batch}/retry-composition"


def composition_source(method, path, project, batch):
    return method == "POST" and path in {create_source(project), retry_source(batch)}


class GridAssetQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=4, max_length=MAX_FILES)

    def path(self, project, batch):
        return f"{ASSETS}/{project}/{batch}/metadata/{self.digest}"


class GridAsset(LibraryAssetDescription):
    byte_size: int = Field(ge=1, le=MAX_IMAGE_BYTES, strict=True)


class GridFileScope(FrameScope):
    files: tuple[FrameFile, ...] = Field(min_length=4, max_length=MAX_FILES)

    def path(self, project, batch):
        return f"{ASSETS}/{project}/{batch}/originals/{self.digest}"


class GridItem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    asset_id: str = Field(pattern=rf"^{ID}$")
    revision: int = Field(ge=0, strict=True)
    byte_size: int = Field(ge=1, le=MAX_IMAGE_BYTES, strict=True)
    caption: str = Field(max_length=120)


class GridPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    items: list[GridItem] = Field(min_length=4, max_length=MAX_FILES)

    @model_validator(mode="after")
    def require_exact_images(self):
        if len(self.items) not in {4, 9} or len({row.asset_id for row in self.items}) != len(
            self.items
        ):
            raise ValueError("宫格图片数量必须为 4 或 9，且素材不能重复")
        if sum(row.byte_size for row in self.items) > MAX_BYTES:
            raise ValueError("宫格原件超过大小限制")
        return self

    @property
    def scope(self):
        return GridFileScope(
            files=tuple(
                FrameFile(id=row.asset_id, revision=row.revision)
                for row in sorted(self.items, key=lambda row: row.asset_id)
            )
        )

    @property
    def digest(self):
        return sha256(self.model_dump_json().encode())

    def path(self, project, batch):
        return f"{RENDER}/{project}/{batch}/{self.digest}/{self.scope.digest}"


def grid_asset_target(method, path):
    return method == "POST" and re.fullmatch(
        rf"{ASSETS}/({ID})/({ID})/(metadata|originals)/({DIGEST})", path
    )


def grid_render_target(method, path):
    return method == "POST" and re.fullmatch(rf"{RENDER}/({ID})/({ID})/({DIGEST})/({DIGEST})", path)


def composition_grant(grant):
    if grant.caller != "visual":
        return False
    if (grant.purpose, grant.target_service) == (ASSET_PURPOSE, "assets"):
        target = grid_asset_target(grant.target_method, grant.target_path)
    elif (grant.purpose, grant.target_service) == (RENDER_PURPOSE, "rendering"):
        target = grid_render_target(grant.target_method, grant.target_path)
    else:
        return False
    return bool(
        target and composition_source(grant.source_method, grant.source_path, target[1], target[2])
    )
