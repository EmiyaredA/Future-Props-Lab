from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ProjectSnapshotAssetManifest(BaseModel):
    source_id: str = Field(min_length=1, max_length=64)
    path: str = Field(min_length=1, max_length=255)
    byte_size: int = Field(ge=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ProjectSnapshotManifest(BaseModel):
    format: Literal["future-props-project-snapshot"]
    format_version: Literal[1]
    application_id: Literal["visual-workshop", "galgame-workshop", "video-editor"]
    exported_at: str = Field(min_length=1, max_length=64)
    source_project: dict
    project_byte_size: int = Field(ge=2)
    project_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    assets: list[ProjectSnapshotAssetManifest]

    @field_validator("assets")
    @classmethod
    def unique_assets(
        cls, value: list[ProjectSnapshotAssetManifest]
    ) -> list[ProjectSnapshotAssetManifest]:
        ids = [item.source_id for item in value]
        paths = [item.path.casefold() for item in value]
        if len(ids) != len(set(ids)) or len(paths) != len(set(paths)):
            raise ValueError("快照素材 ID 和路径不能重复")
        return value


class ProjectSnapshotImportWarning(BaseModel):
    code: Literal["model_binding_unavailable"]
    field: str
    message: str


class ProjectFolderOpenOut(BaseModel):
    opened: Literal[True] = True
