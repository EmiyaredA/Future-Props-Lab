"""Fixed private library metadata and version-bound byte transport for Thought."""

import hashlib
import json
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

ID = r"[A-Za-z0-9_-]{1,128}"
PREFIX = "/_internal/v1/thought-library"


class AssetQuery(BaseModel):
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

    @property
    def path(self):
        return PREFIX + "/metadata/" + self.digest


class AssetDescription(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern="^" + ID + "$")
    original_filename: str = Field(min_length=1, max_length=1024)
    mime_type: str = Field(min_length=1, max_length=255)
    media_kind: str = Field(min_length=1, max_length=32)
    byte_size: int = Field(ge=0, strict=True)
    revision: int = Field(ge=0, strict=True)

    @property
    def content_path(self):
        return PREFIX + "/content/" + self.id + "/" + str(self.revision)


def asset_grant(grant):
    if not (
        grant.caller == "thought"
        and grant.purpose == "thought.library.read"
        and grant.source_path.startswith("/v1/thought-workshop/")
        and grant.target_service == "assets"
    ):
        return False
    return bool(
        (
            grant.target_method == "POST"
            and re.fullmatch(PREFIX + r"/metadata/[0-9a-f]{64}", grant.target_path)
        )
        or (
            grant.target_method == "GET"
            and re.fullmatch(PREFIX + r"/content/" + ID + r"/[0-9]{1,20}", grant.target_path)
        )
    )


def upload_grant(grant):
    """Authorize only an upload kind matching its original Thought endpoint."""
    if not (
        grant.caller == "thought"
        and grant.purpose == "thought.library.upload"
        and grant.source_method == "POST"
        and grant.target_service == "assets"
        and grant.target_method == "POST"
    ):
        return False
    kind = {
        "/v1/thought-workshop/images": "image",
        "/v1/thought-workshop/attachments": "attachment",
    }.get(grant.source_path)
    return bool(
        kind
        and re.fullmatch(
            PREFIX + r"/uploads/" + kind + r"/" + ID + r"/[0-9a-f]{64}", grant.target_path
        )
    )
