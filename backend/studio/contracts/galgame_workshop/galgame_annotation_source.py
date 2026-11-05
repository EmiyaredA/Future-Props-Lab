"""Narrow Annotation source and original audio hash for one Galgame import."""

import re

from pydantic import BaseModel, ConfigDict, Field

from studio.contracts.asset_library.descriptions import ID
from studio.contracts.galgame_workshop.galgame_assets import SOURCE

ANNOTATION_PATH = "/_internal/v1/galgame-annotation-source"
AUDIO_PATH = "/_internal/v1/galgame-annotation-audio"
ANNOTATION_PURPOSE = "galgame.annotation-source.read"
AUDIO_PURPOSE = "galgame.annotation-audio.verify"


class Speaker(BaseModel):
    id: str


class LocalizedText(BaseModel):
    language: str
    text: str


class Segment(BaseModel):
    id: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    speaker_ids: list[str]
    text: str
    language: str | None = None
    localized_texts: list[LocalizedText] = Field(default_factory=list)


class AnnotationSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=rf"^{ID}$")
    asset_id: str = Field(pattern=rf"^{ID}$")
    duration_ms: int = Field(gt=0)
    revision: int = Field(ge=0)
    speakers: list[Speaker]
    segments: list[Segment]


class AudioDigest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


def annotation_target(method, path):
    return method == "GET" and re.fullmatch(rf"{ANNOTATION_PATH}/({ID})/({ID})", path)


def audio_target(method, path):
    return method == "GET" and re.fullmatch(
        rf"{AUDIO_PATH}/({ID})/({ID})/({ID})(?:/original/(?P<sha256>[0-9a-f]{{64}}))?", path
    )


def import_paths(project):
    root = f"{SOURCE}/{project}/annotation-imports"
    return {root, root + "/preview"}


def source_grant(grant):
    if grant.caller != "galgame" or grant.source_method != "POST":
        return False
    destination = (grant.target_service, grant.purpose)
    if destination == ("annotation", ANNOTATION_PURPOSE):
        target = annotation_target(grant.target_method, grant.target_path)
    elif destination == ("assets", AUDIO_PURPOSE):
        target = audio_target(grant.target_method, grant.target_path)
    else:
        return False
    if not target:
        return False
    if destination == ("assets", AUDIO_PURPOSE) and target["sha256"]:
        return grant.source_path == f"{SOURCE}/{target[1]}/annotation-imports"
    return grant.source_path in import_paths(target[1])
