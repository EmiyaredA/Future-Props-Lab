"""One archive and its exact media and project projection."""

import hashlib
import json
import re
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .asset_references import ReferenceUpdate
from .presentation_assets import SOURCE
from .thought_archives import ArchiveFileKey

IMPORT = SOURCE + "/imports"
PREFIX = "/_internal/v1/presentation-archives"
SETTLE = PREFIX + "/settle"
PURPOSE = "presentation.archive.stage"
DOMAIN = b"fpl-presentation-archive-v1"
MAX_BYTES = 100 * 1024 * 1024


class PresentationManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    project_id: UUID
    files: list[ArchiveFileKey] = Field(min_length=1, max_length=5000)
    asset_ids: list[str] = Field(min_length=1, max_length=10000)

    @field_validator("asset_ids")
    @classmethod
    def canonical_assets(cls, values):
        return ReferenceUpdate.canonical_assets(values)

    @model_validator(mode="after")
    def canonical_files(self):
        if self.project_id.version != 4 or [file.ordinal for file in self.files] != list(
            range(len(self.files))
        ):
            raise ValueError("文稿归档项目或素材序号无效")
        return self

    @property
    def fingerprint(self):
        return hashlib.sha256(
            json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()


def archive_target(method, path):
    return method == "POST" and re.fullmatch(
        PREFIX + r"/([a-f0-9]{32})/([a-f0-9]{64})/(files/[0-9]{1,4}|seal)/([a-f0-9]{64})",
        path,
    )


def presentation_archive_grant(grant):
    return bool(
        grant.caller == "presentation"
        and grant.purpose == PURPOSE
        and (grant.source_method, grant.source_path) == ("POST", IMPORT)
        and grant.target_service == "assets"
        and archive_target(grant.target_method, grant.target_path)
    )
