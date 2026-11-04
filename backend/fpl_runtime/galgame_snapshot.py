"""Version-bound scope for portable Galgame project snapshot originals."""

import re

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .galgame_assets import PREFIX, SOURCE
from .library_assets import ID
from .motion_preview import DIGEST, sha256
from .motion_snapshot import MotionArchiveManifest
from .thought_archives import ArchiveFileKey

FILES_PURPOSE = "galgame.snapshot-originals.read"
IMPORT = SOURCE + "/snapshot-imports"


def snapshot_files_target(method, path):
    return method == "POST" and re.fullmatch(rf"{PREFIX}/({ID})/snapshot/({DIGEST})", path)


def snapshot_files_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "galgame",
        FILES_PURPOSE,
        "assets",
        "GET",
    ):
        return False
    target = snapshot_files_target(grant.target_method, grant.target_path)
    return bool(target and grant.source_path == f"{SOURCE}/{target[1]}/snapshot")


MODEL_REFERENCE_PREFIX = "/_internal/v1/galgame-snapshot-model-reference"
MODEL_PURPOSE = "galgame.snapshot-model.read"
MODEL_RESOLVE_PREFIX = "/_internal/v1/galgame-snapshot-model-resolution"


class ModelReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_kind: str = Field(min_length=1, max_length=120)
    model_slug: str = Field(min_length=1, max_length=160)

    @property
    def digest(self):
        return sha256(self.model_dump_json().encode())


def model_reference_target(method, path):
    return method == "GET" and re.fullmatch(rf"{MODEL_REFERENCE_PREFIX}/({ID})", path)


def model_resolution_target(method, path):
    return method == "POST" and re.fullmatch(rf"{MODEL_RESOLVE_PREFIX}/({DIGEST})", path)


def snapshot_model_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service) != ("galgame", MODEL_PURPOSE, "models"):
        return False
    if grant.source_method == "GET":
        return bool(
            re.fullmatch(rf"{SOURCE}/{ID}/snapshot", grant.source_path)
            and model_reference_target(grant.target_method, grant.target_path)
        )
    return bool(
        (grant.source_method, grant.source_path) == ("POST", IMPORT)
        and model_resolution_target(grant.target_method, grant.target_path)
    )


ARCHIVE_PREFIX = "/_internal/v1/galgame-archives"
ARCHIVE_PURPOSE = "galgame.archive.stage"
ARCHIVE_DOMAIN = b"fpl-galgame-archive-v1"


class GalgameArchiveManifest(MotionArchiveManifest):
    files: list[ArchiveFileKey] = Field(max_length=9998)
    story_ordinals: list[int] = Field(max_length=9998)

    @model_validator(mode="after")
    def exact_story_files(self):
        if self.story_ordinals != sorted(set(self.story_ordinals)) or any(
            not 0 <= ordinal < len(self.files) for ordinal in self.story_ordinals
        ):
            raise ValueError("Galgame 归档的 Story 素材序号无效")
        return self


def archive_target(method, path):
    return method == "POST" and re.fullmatch(
        ARCHIVE_PREFIX + rf"/([a-f0-9]{{32}})/({DIGEST})/(files/[0-9]{{1,4}}|seal)/({DIGEST})",
        path,
    )


def archive_grant(grant):
    return bool(
        (grant.caller, grant.purpose, grant.target_service)
        == ("galgame", ARCHIVE_PURPOSE, "assets")
        and (grant.source_method, grant.source_path) == ("POST", IMPORT)
        and archive_target(grant.target_method, grant.target_path)
    )
