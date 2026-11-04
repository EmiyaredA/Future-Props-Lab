"""Audio annotation only needs an owned source description and temporary read access."""

from dataclasses import dataclass
from pathlib import Path

from fpl_runtime.library_assets import LibraryAssetDescription


class AudioAnnotationError(Exception):
    def __init__(self, message: str, *, code: str = "audio_annotation_error", status: int = 422):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class AnnotationAudio:
    description: LibraryAssetDescription
    owner_user_id: str
    display_name: str

    @property
    def id(self):
        return self.description.id

    @property
    def original_filename(self):
        return self.description.original_filename

    @property
    def mime_type(self):
        return self.description.mime_type

    @property
    def byte_size(self):
        return self.description.byte_size


@dataclass(frozen=True)
class TranscriptionSource:
    asset: AnnotationAudio
    filename: str
    text: str
    segments: list
    staged: Path | None = None
