"""Read an owned saved revision before exporting or recognizing its audio.

Recognition returns a candidate transcript; it never writes the document or
decides its final revision. The editor commits later through its CAS operation.
"""

from typing import Protocol

from studio.apps.audio_annotation.rules.export_document import render_document
from studio.apps.audio_annotation.schemas.document import (
    AudioAnnotationDocumentOut,
    AudioAnnotationProjectOut,
    AudioAnnotationSegment,
    AudioAnnotationSegmentTranscriptionOut,
)
from studio.apps.audio_annotation.schemas.operations import SavedSegmentTranscriptionIn
from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.runtime.revisions import RevisionConflictError


class SavedDocuments(Protocol):
    async def get(self, project_id: str) -> AudioAnnotationProjectOut: ...

    async def get_document(self, project_id: str) -> AudioAnnotationDocumentOut: ...


class AudioClips(Protocol):
    async def read(self, asset_id: str, start_ms: int, end_ms: int) -> bytes:
        """Borrow authorized audio and return WAV bytes, cleaning temporary files.

        Adapter releases database reads before media I/O and closes the source on
        success, error or cancellation. No native path escapes this operation.
        """
        ...


class SavedRecognition(Protocol):
    async def recognize(
        self,
        project_id: str,
        segment: AudioAnnotationSegment,
        command: SavedSegmentTranscriptionIn,
        content: bytes,
    ) -> AudioAnnotationSegmentTranscriptionOut:
        """Execute one authorized attempt; never retry an unknown provider result."""
        ...


class SavedAudio:
    def __init__(
        self, *, documents: SavedDocuments, clips: AudioClips, recognition: SavedRecognition, clock
    ):
        self.documents, self.clips = documents, clips
        self.recognition, self.clock = recognition, clock

    async def snapshot(self, project_id, expected_revision):
        project = await self.documents.get(project_id)
        document = await self.documents.get_document(project_id)
        if document.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision, document.revision, document.model_dump(mode="json")
            )
        return project, document

    async def export(self, project_id, expected_revision, format):
        project, document = await self.snapshot(project_id, expected_revision)
        return render_document(project, document, format, exported_at=self.clock())

    async def clip(self, project_id, segment_id, expected_revision):
        project, document = await self.snapshot(project_id, expected_revision)
        segment = next((item for item in document.segments if item.id == segment_id), None)
        if segment is None:
            raise AudioAnnotationError("片段不存在", code="not_found", status=404)
        content = await self.clips.read(project.asset_id, segment.start_ms, segment.end_ms)
        return content, segment

    async def transcribe(self, project_id, segment_id, command: SavedSegmentTranscriptionIn):
        content, segment = await self.clip(project_id, segment_id, command.expected_revision)
        return await self.recognition.recognize(project_id, segment, command, content)
