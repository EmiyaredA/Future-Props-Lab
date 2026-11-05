"""Authorize a project range before a single external transcription attempt."""

from dataclasses import dataclass
from typing import Protocol

from studio.apps.audio_annotation.rules.documents import MIN_SEGMENT_MS
from studio.apps.audio_annotation.schemas.document import AudioAnnotationSegmentTranscriptionOut
from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.contracts.asset_library.incoming import IncomingFile


@dataclass(frozen=True)
class TranscriptionScope:
    owner: str
    duration_ms: int


class TranscriptionProjects(Protocol):
    async def load(self, project_id: str) -> TranscriptionScope:
        """Load an owned project and release its read transaction before returning."""
        ...


class TranscriptionExecutor(Protocol):
    async def __call__(
        self,
        project_id: str,
        *,
        owner_user_id: str,
        upload: IncomingFile,
        model_id: str,
        segment_id: str,
        start_ms: int,
        end_ms: int,
        language_tag: str | None,
        target_language_tag: str | None,
        principal=None,
    ) -> AudioAnnotationSegmentTranscriptionOut:
        """Execute once, normalize the result and record any unknown outcome.

        Adapter must enforce model authorization and input limits. Neither caller
        nor adapter retries a possibly accepted external attempt automatically.
        """
        ...


class TranscribeSegment:
    def __init__(self, projects: TranscriptionProjects, executor: TranscriptionExecutor):
        self.projects, self.executor = projects, executor

    async def __call__(self, project_id, *, upload: IncomingFile, principal=None, **parameters):
        try:
            scope = await self.projects.load(project_id)
            if principal is not None and principal.user_id != scope.owner:
                raise AudioAnnotationError("标注任务不存在", code="not_found", status=404)
            start, end = parameters["start_ms"], parameters["end_ms"]
            if end - start < MIN_SEGMENT_MS:
                raise AudioAnnotationError("片段长度不能小于 100 毫秒", code="segment_too_short")
            if start < 0 or end > scope.duration_ms:
                raise AudioAnnotationError("片段超出音频时长", code="segment_out_of_range")
            return await self.executor(
                project_id,
                owner_user_id=scope.owner,
                upload=upload,
                principal=principal,
                **parameters,
            )
        finally:
            await upload.close()
