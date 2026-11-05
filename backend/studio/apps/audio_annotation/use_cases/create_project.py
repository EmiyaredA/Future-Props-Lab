"""Create owned annotation documents without exposing SQL, media paths or SDKs."""

from contextlib import AbstractAsyncContextManager
from typing import Protocol

from pydantic import ValidationError

from studio.apps.audio_annotation.rules.audio import require_audio, require_duration
from studio.apps.audio_annotation.rules.documents import (
    transcription_document,
    validate_document,
)
from studio.apps.audio_annotation.schemas.document import (
    AudioAnnotationImportIn,
    AudioAnnotationProjectCreateIn,
    AudioAnnotationProjectOut,
    AudioAnnotationSegment,
    AudioAnnotationTranscriptionImportIn,
    AudioAnnotationTranscriptionSegmentIn,
)
from studio.apps.audio_annotation.sources import AnnotationAudio, AudioAnnotationError


class TranscriptInput(Protocol):
    filename_stem: str
    text: str
    segments: list[dict]

    async def duration(self) -> int: ...

    async def publish(self) -> AnnotationAudio:
        """Reuse the authorized asset or prepare a new original under the lease.

        Local staged records join the project transaction; remote publication uses
        the existing durable source protocol. Unknown remote outcomes must not be
        blindly repeated or cleaned as if publication had failed.
        """
        ...


class CreationInputs(Protocol):
    async def describe(self, asset_id: str) -> AnnotationAudio | None: ...

    async def duration(self, audio: AnnotationAudio) -> int: ...

    def transcription(self, task_id: str) -> AbstractAsyncContextManager[TranscriptInput]:
        """Borrow a verified task source; the adapter owns cleanup on every exit."""
        ...


class CreationStore(Protocol):
    async def commit_creation(
        self,
        *,
        project_id: str,
        title: str,
        asset: AnnotationAudio,
        duration_ms: int,
        speakers: list,
        segments: list,
        custom_emotions: list | None = None,
    ) -> AudioAnnotationProjectOut:
        """Atomically create project, document, waveform and reference delivery.

        The store is bound to the same owner as the inputs. SQL/ORM and reference
        transaction handles stay inside the adapter. A commit with unknown outcome
        is not an authorization to create a second project automatically.
        """
        ...


class CreateProject:
    def __init__(self, *, owner: str, inputs: CreationInputs, store: CreationStore, ids):
        self.owner, self.inputs, self.store, self.ids = owner, inputs, store, ids

    def _audio(self, value):
        if value is None or value.owner_user_id != self.owner:
            raise AudioAnnotationError("音频文件不存在", code="not_found", status=404)
        return require_audio(value)

    async def create(self, body: AudioAnnotationProjectCreateIn):
        audio = self._audio(await self.inputs.describe(body.asset_id))
        duration = require_duration(await self.inputs.duration(audio))
        segment = AudioAnnotationSegment(
            id=self.ids(), start_ms=0, end_ms=duration, speaker_id=None, text="", status="draft"
        )
        return await self.store.commit_creation(
            project_id=self.ids(),
            title=body.title,
            asset=audio,
            duration_ms=duration,
            speakers=[],
            custom_emotions=[],
            segments=[segment],
        )

    async def import_project(self, body: AudioAnnotationImportIn):
        audio = self._audio(await self.inputs.describe(body.asset_id))
        duration = require_duration(await self.inputs.duration(audio))
        validate_document(duration, body)
        return await self.store.commit_creation(
            project_id=self.ids(),
            title=body.title,
            asset=audio,
            duration_ms=duration,
            speakers=body.speakers,
            custom_emotions=body.custom_emotions,
            segments=body.segments,
        )

    async def import_transcription(self, body: AudioAnnotationTranscriptionImportIn):
        if body.source_kind == "json":
            audio = self._audio(await self.inputs.describe(body.asset_id))
            duration = require_duration(await self.inputs.duration(audio))
            speakers, segments = transcription_document(
                text=body.text, segments=body.segments, duration_ms=duration, ids=self.ids
            )
            title = body.title
        else:
            async with self.inputs.transcription(body.task_id) as source:
                title = (body.title or source.filename_stem.strip() or "录音标注")[:120]
                try:
                    transcript = [
                        AudioAnnotationTranscriptionSegmentIn.model_validate(item)
                        for item in source.segments
                    ]
                except ValidationError as exc:
                    raise AudioAnnotationError(
                        "识别任务的分段数据格式无效", code="transcription_segments_invalid"
                    ) from exc
                duration = require_duration(await source.duration())
                speakers, segments = transcription_document(
                    text=source.text, segments=transcript, duration_ms=duration, ids=self.ids
                )
                audio = self._audio(await source.publish())
                # The lease includes the complete project transaction so local
                # staged asset cleanup can distinguish rollback from commit.
                return await self.store.commit_creation(
                    project_id=self.ids(),
                    title=title,
                    asset=audio,
                    duration_ms=duration,
                    speakers=speakers,
                    segments=segments,
                )
        return await self.store.commit_creation(
            project_id=self.ids(),
            title=title,
            asset=audio,
            duration_ms=duration,
            speakers=speakers,
            segments=segments,
        )
