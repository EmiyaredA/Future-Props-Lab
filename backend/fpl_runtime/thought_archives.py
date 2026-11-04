"""File manifests for Thought archive staging, with no paths or account override."""

import hashlib
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .asset_references import ReferenceUpdate

BatchId = Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]
Fingerprint = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class ArchiveBatchKey(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    batch_id: BatchId
    source_sha256: Fingerprint


class ArchiveFileKey(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    ordinal: int = Field(ge=0, lt=10_000, strict=True)
    descriptor_sha256: Fingerprint


class ArchiveProjection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    resource_kind: Literal["knowledge-base", "note", "template"]
    resource_id: str = Field(pattern=r"^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$")
    resource_revision: int = Field(ge=0, strict=True)
    asset_ids: list[str] = Field(max_length=10_000)

    @field_validator("asset_ids")
    @classmethod
    def canonical_assets(cls, values):
        return ReferenceUpdate.canonical_assets(values)


class ArchiveManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    files: list[ArchiveFileKey] = Field(max_length=10_000)
    projections: list[ArchiveProjection] = Field(max_length=30_000)

    @model_validator(mode="after")
    def canonical_manifest(self):
        if [file.ordinal for file in self.files] != list(range(len(self.files))):
            raise ValueError("归档文件序号必须连续")
        keys = [(ref.resource_kind, ref.resource_id) for ref in self.projections]
        if keys != sorted(set(keys)):
            raise ValueError("归档资源必须按类型与标识排序且不得重复")
        return self

    @property
    def fingerprint(self):
        return hashlib.sha256(
            json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
