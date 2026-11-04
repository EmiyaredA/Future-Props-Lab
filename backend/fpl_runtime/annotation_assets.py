"""Request-scoped Annotation access to ordinary Assets metadata and audio bytes."""

import re

from pydantic import Field

from .annotation_transcription import SEGMENT
from .library_assets import ID, LibraryAssetDescription, LibraryAssetQuery

PREFIX = "/_internal/v1/annotation-assets"
SOURCE = "/v1/audio-annotation"
PURPOSE = "annotation.audio-input.read"
MAX_AUDIO_BYTES = 100 * 1024 * 1024
MAX_IDS = 64
_PROJECT = rf"{SOURCE}/projects/{ID}"
_SEGMENT = rf"{_PROJECT}/segments/{SEGMENT}"
PROJECT_CREATION = frozenset(
    {
        f"{SOURCE}/projects",
        f"{SOURCE}/imports",
        f"{SOURCE}/transcription-imports",
    }
)


class AudioAssetQuery(LibraryAssetQuery):
    asset_ids: list[str] = Field(min_length=1, max_length=MAX_IDS)

    @property
    def path(self):
        return f"{PREFIX}/metadata/{self.digest}"


class AudioAssetDescription(LibraryAssetDescription):
    display_name: str = Field(max_length=1024)

    @property
    def content_path(self):
        return f"{PREFIX}/content/{self.id}/{self.revision}"


def audio_asset_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.target_method) != (
        "annotation",
        PURPOSE,
        "assets",
        "GET",
    ):
        return False
    method, path = grant.source_method, grant.source_path
    create = method == "POST" and path in PROJECT_CREATION
    clip = (method == "GET" and re.fullmatch(_SEGMENT + "/audio", path)) or (
        method == "POST" and re.fullmatch(_SEGMENT + "/transcribe-saved", path)
    )
    if re.fullmatch(PREFIX + r"/metadata/[a-f0-9]{64}", grant.target_path):
        return bool(
            create
            or clip
            or (method == "GET" and path == f"{SOURCE}/projects")
            or (method == "GET" and re.fullmatch(_PROJECT + "(?:/export)?", path))
            or (method in {"PATCH", "DELETE"} and re.fullmatch(_PROJECT, path))
        )
    return bool(
        (create or clip)
        and re.fullmatch(rf"{PREFIX}/content/{ID}/[0-9]{{1,20}}", grant.target_path)
    )
