"""Allow Galgame to check only a single account model's ASR readiness."""

import re

from pydantic import BaseModel, ConfigDict, StrictBool

from .galgame_assets import SOURCE
from .library_assets import ID

PREFIX = "/_internal/v1/galgame-asr-models"
PURPOSE = "galgame.transcription-model.read"


class AsrModelStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ready: StrictBool


def asr_model_target(method, path):
    if method == "GET":
        return re.fullmatch(rf"{PREFIX}/({ID})", path)
    return None


def asr_model_grant(grant):
    return (
        grant.caller == "galgame"
        and grant.purpose == PURPOSE
        and grant.target_service == "models"
        and grant.source_method in {"GET", "PATCH"}
        and bool(re.fullmatch(rf"{SOURCE}/{ID}/assets/asr/settings", grant.source_path))
        and bool(asr_model_target(grant.target_method, grant.target_path))
    )
