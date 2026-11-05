"""Bound an archive export to a canonical versioned project media scope."""

import re
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .library_assets import ID
from .motion_assets import PREFIX, SOURCE
from .motion_preview import DIGEST, FrameFile, FrameScope
from .thought_archives import ArchiveFileKey

PURPOSE = "motion.snapshot.read"
MAX_SCOPE_BYTES = 4 * 1024 * 1024


class SnapshotScope(FrameScope):
    files: tuple[FrameFile, ...] = Field(max_length=10000)


def snapshot_target(method, path):
    return method == "POST" and re.fullmatch(rf"{PREFIX}/({ID})/snapshot/({DIGEST})", path)


def motion_snapshot_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "motion",
        PURPOSE,
        "assets",
        "GET",
    ):
        return False
    target = snapshot_target(grant.target_method, grant.target_path)
    return bool(target and grant.source_path == f"{SOURCE}/projects/{target[1]}/snapshot")


IMPORT = SOURCE + "/projects/snapshot-imports"
ARCHIVE_PREFIX = "/_internal/v1/motion-archives"
ARCHIVE_PURPOSE = "motion.archive.stage"
ARCHIVE_DOMAIN = b"fpl-motion-archive-v1"
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024


class MotionArchiveManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    project_id: UUID
    files: list[ArchiveFileKey] = Field(max_length=500)

    @model_validator(mode="after")
    def canonical_files(self):
        if self.project_id.version != 4 or [item.ordinal for item in self.files] != list(
            range(len(self.files))
        ):
            raise ValueError("特效归档项目或文件序号无效")
        return self

    @property
    def fingerprint(self):
        from .motion_preview import sha256

        return sha256(self.model_dump_json().encode())


def motion_archive_target(method, path):
    return method == "POST" and re.fullmatch(
        ARCHIVE_PREFIX + rf"/([a-f0-9]{{32}})/({DIGEST})/(files/[0-9]{{1,3}}|seal)/({DIGEST})",
        path,
    )


def motion_archive_grant(grant):
    return bool(
        grant.caller == "motion"
        and grant.purpose == ARCHIVE_PURPOSE
        and (grant.source_method, grant.source_path) == ("POST", IMPORT)
        and grant.target_service == "assets"
        and motion_archive_target(grant.target_method, grant.target_path)
    )
