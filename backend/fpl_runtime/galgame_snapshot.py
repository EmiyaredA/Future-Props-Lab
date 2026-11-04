"""Version-bound scope for portable Galgame project snapshot originals."""

import re

from pydantic import BaseModel, ConfigDict, Field

from .galgame_assets import PREFIX, SOURCE
from .library_assets import ID
from .motion_preview import DIGEST

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


class ModelReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_kind: str = Field(min_length=1, max_length=120)
    model_slug: str = Field(min_length=1, max_length=160)


def model_reference_target(method, path):
    return method == "GET" and re.fullmatch(rf"{MODEL_REFERENCE_PREFIX}/({ID})", path)


def model_reference_grant(grant):
    return (
        (grant.caller, grant.purpose, grant.target_service, grant.source_method)
        == ("galgame", MODEL_PURPOSE, "models", "GET")
        and bool(re.fullmatch(rf"{SOURCE}/{ID}/snapshot", grant.source_path))
        and bool(model_reference_target(grant.target_method, grant.target_path))
    )
