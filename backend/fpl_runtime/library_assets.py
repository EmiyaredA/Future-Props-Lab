"""Canonical metadata shapes and digest for scoped library reads."""

import hashlib
import json
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

ID = r"[A-Za-z0-9_-]{1,128}"


class LibraryAssetQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asset_ids: list[str] = Field(max_length=10000)

    @field_validator("asset_ids")
    @classmethod
    def canonical(cls, values):
        if len(set(values)) != len(values) or any(not re.fullmatch(ID, x) for x in values):
            raise ValueError("素材标识无效或重复")
        return sorted(values)

    @property
    def digest(self):
        return hashlib.sha256(
            json.dumps(self.model_dump(), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()


class LibraryAssetDescription(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern="^" + ID + "$")
    original_filename: str = Field(min_length=1, max_length=1024)
    mime_type: str = Field(min_length=1, max_length=255)
    media_kind: str = Field(min_length=1, max_length=32)
    byte_size: int = Field(ge=0, strict=True)
    revision: int = Field(ge=0, strict=True)
