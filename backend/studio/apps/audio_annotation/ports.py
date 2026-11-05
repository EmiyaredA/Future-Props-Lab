"""Request-owned project operations exposed to the HTTP adapter.

The implementation binds account access and source/reference adapters at assembly.
Writes apply their expected revision atomically; callers receive detached snapshots.
"""

from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Protocol

from studio.apps.audio_annotation.schemas.document import (
    AudioAnnotationDocumentOut,
    AudioAnnotationDocumentPutIn,
    AudioAnnotationProjectListOut,
    AudioAnnotationProjectOut,
    AudioAnnotationProjectPatchIn,
    AudioAnnotationWaveformOut,
    AudioAnnotationWaveformPutIn,
)
from studio.apps.audio_annotation.sources import AnnotationAudio


class AudioSources(Protocol):
    """Owned metadata and borrowed media access, independent of local or HTTP storage.

    The adapter validates ownership, revision and length. A path returned by open is
    usable only inside its context; the adapter owns cleanup on completion/cancel.
    """

    async def describe(self, asset_id: str) -> AnnotationAudio | None: ...

    async def describe_many(self, asset_ids: set[str]) -> dict[str, AnnotationAudio]: ...

    def open(self, audio: AnnotationAudio) -> AbstractAsyncContextManager[Path]: ...


class ProjectOperations(Protocol):
    async def list(self, query: str = "") -> AudioAnnotationProjectListOut: ...

    async def get(self, project_id: str) -> AudioAnnotationProjectOut: ...

    async def patch(
        self, project_id: str, body: AudioAnnotationProjectPatchIn
    ) -> AudioAnnotationProjectOut: ...

    async def get_document(self, project_id: str) -> AudioAnnotationDocumentOut: ...

    async def put_document(
        self, project_id: str, body: AudioAnnotationDocumentPutIn, *, commit: bool = True
    ) -> AudioAnnotationDocumentOut: ...

    async def get_waveform(self, project_id: str) -> AudioAnnotationWaveformOut: ...

    async def put_waveform(
        self, project_id: str, body: AudioAnnotationWaveformPutIn
    ) -> AudioAnnotationWaveformOut: ...
