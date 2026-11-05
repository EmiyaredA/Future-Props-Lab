from __future__ import annotations

import asyncio
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from tinytag import TinyTag

from app.runtime.operation_receipts import forget
from studio.apps.audio_annotation.models import (
    AudioAnnotationDocument,
    AudioAnnotationProject,
    AudioAnnotationWaveform,
)
from studio.apps.audio_annotation.ports import AudioSources
from studio.apps.audio_annotation.schemas.document import (
    AudioAnnotationCustomEmotion,
    AudioAnnotationDocumentOut,
    AudioAnnotationDocumentPutIn,
    AudioAnnotationImportIn,
    AudioAnnotationProjectCreateIn,
    AudioAnnotationProjectListOut,
    AudioAnnotationProjectOut,
    AudioAnnotationProjectPatchIn,
    AudioAnnotationSegment,
    AudioAnnotationSpeaker,
    AudioAnnotationTranscriptionImportIn,
    AudioAnnotationTranscriptionSegmentIn,
    AudioAnnotationWaveformOut,
    AudioAnnotationWaveformPutIn,
)
from studio.apps.audio_annotation.sources import AnnotationAudio
from studio.apps.audio_annotation.sources import AudioAnnotationError as AudioAnnotationError
from studio.contracts.asset_library.annotation import MAX_AUDIO_BYTES
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import iso_utc, utc_now

MAX_DURATION_MS = 60 * 60 * 1000
MIN_SEGMENT_MS = 100
TRANSCRIPTION_SPEAKER_COLORS = (
    "#28B8A7",
    "#4C8FE8",
    "#9B62D0",
    "#E7A72F",
    "#ED7A52",
    "#D85E9D",
    "#7586E5",
    "#46B978",
)


class AudioAnnotationProjects:
    def __init__(self, session: AsyncSession, *, sources: AudioSources, references=None) -> None:
        self.session = session
        self.sources = sources
        self.references = references

    async def _project(self, project_id: str) -> AudioAnnotationProject:
        row = await self.session.get(AudioAnnotationProject, project_id)
        if row is None:
            raise AudioAnnotationError("标注任务不存在", code="not_found", status=404)
        return row

    async def _asset(self, asset_id: str) -> AnnotationAudio:
        value = await self.sources.describe(asset_id)
        if value is None:
            raise AudioAnnotationError("音频文件不存在", code="not_found", status=404)
        if value.description.media_kind != "audio":
            raise AudioAnnotationError("标注任务只能使用音频文件", code="invalid_audio")
        if value.byte_size > MAX_AUDIO_BYTES:
            raise AudioAnnotationError("音频不能超过 100 MiB", code="audio_too_large", status=413)
        return value

    async def _duration(self, asset: AnnotationAudio) -> int:
        async with self.sources.open(asset) as path:
            return await self._measure_duration(path)

    @staticmethod
    async def _measure_duration(path: Path) -> int:
        try:
            tag = await asyncio.to_thread(TinyTag.get, path)
            duration_ms = round(float(tag.duration or 0) * 1000)
        except (OSError, ValueError) as exc:
            raise AudioAnnotationError("无法读取音频时长", code="audio_metadata_invalid") from exc
        if duration_ms <= 0:
            raise AudioAnnotationError("音频时长无效", code="audio_metadata_invalid")
        if duration_ms > MAX_DURATION_MS:
            raise AudioAnnotationError("音频不能超过 60 分钟", code="audio_too_long", status=413)
        return duration_ms

    @staticmethod
    def _document_out(row: AudioAnnotationDocument) -> AudioAnnotationDocumentOut:
        return AudioAnnotationDocumentOut(
            project_id=row.project_id,
            schema_version=row.schema_version,
            speakers=row.speakers,
            custom_emotions=row.custom_emotions or [],
            segments=row.segments,
            revision=row.revision,
            updated_at=iso_utc(row.updated_at),
        )

    @staticmethod
    def _waveform_out(row: AudioAnnotationWaveform) -> AudioAnnotationWaveformOut:
        return AudioAnnotationWaveformOut(
            project_id=row.project_id,
            duration_ms=row.duration_ms,
            peaks=row.peaks,
            revision=row.revision,
            updated_at=iso_utc(row.updated_at),
        )

    async def _project_out(
        self, row: AudioAnnotationProject, asset: AnnotationAudio | None
    ) -> AudioAnnotationProjectOut:
        document = await self.session.get(AudioAnnotationDocument, row.id)
        waveform = await self.session.get(AudioAnnotationWaveform, row.id)
        if asset is None or document is None or waveform is None:
            raise AudioAnnotationError("标注任务数据不完整", code="project_corrupt", status=500)
        reviewed = sum(1 for segment in document.segments if segment.get("status") == "reviewed")
        return AudioAnnotationProjectOut(
            id=row.id,
            title=row.title,
            asset_id=asset.id,
            asset_display_name=asset.display_name,
            original_filename=asset.original_filename,
            mime_type=asset.mime_type,
            byte_size=asset.byte_size,
            duration_ms=row.duration_ms,
            segment_count=len(document.segments),
            reviewed_segment_count=reviewed,
            waveform_ready=bool(waveform.peaks),
            document_revision=document.revision,
            revision=row.revision,
            created_at=iso_utc(row.created_at),
            updated_at=iso_utc(row.updated_at),
        )

    def _validate_document(
        self,
        duration_ms: int,
        body: AudioAnnotationDocumentPutIn | AudioAnnotationImportIn,
    ) -> None:
        speaker_ids = {speaker.id for speaker in body.speakers}
        previous_start = -1
        for segment in body.segments:
            if segment.end_ms - segment.start_ms < MIN_SEGMENT_MS:
                raise AudioAnnotationError("片段长度不能小于 100 毫秒", code="segment_too_short")
            if segment.end_ms > duration_ms:
                raise AudioAnnotationError("片段超出音频时长", code="segment_out_of_range")
            if segment.start_ms < previous_start:
                raise AudioAnnotationError("片段必须按开始时间排序", code="segments_unsorted")
            if any(speaker_id not in speaker_ids for speaker_id in segment.speaker_ids):
                raise AudioAnnotationError("片段引用了不存在的说话人", code="speaker_not_found")
            previous_start = segment.start_ms

    async def list(self, query: str = "") -> AudioAnnotationProjectListOut:
        statement = select(AudioAnnotationProject).order_by(
            AudioAnnotationProject.updated_at.desc(),
            AudioAnnotationProject.created_at.desc(),
        )
        if query:
            statement = statement.where(AudioAnnotationProject.title.ilike(f"%{query}%"))
        rows = (await self.session.execute(statement)).scalars().all()
        assets = await self.sources.describe_many({row.asset_id for row in rows})
        return AudioAnnotationProjectListOut(
            items=[await self._project_out(row, assets.get(row.asset_id)) for row in rows]
        )

    async def get(self, project_id: str) -> AudioAnnotationProjectOut:
        row = await self._project(project_id)
        return await self._project_out(row, await self.sources.describe(row.asset_id))

    async def create(self, body: AudioAnnotationProjectCreateIn) -> AudioAnnotationProjectOut:
        asset = await self._asset(body.asset_id)
        duration_ms = await self._duration(asset)
        segment = AudioAnnotationSegment(
            id=new_id(), start_ms=0, end_ms=duration_ms, speaker_id=None, text="", status="draft"
        )
        return await self._create_project_record(
            title=body.title,
            asset=asset,
            duration_ms=duration_ms,
            speakers=[],
            custom_emotions=[],
            segments=[segment],
        )

    async def import_project(self, body: AudioAnnotationImportIn) -> AudioAnnotationProjectOut:
        asset = await self._asset(body.asset_id)
        duration_ms = await self._duration(asset)
        self._validate_document(duration_ms, body)
        return await self._create_project_record(
            title=body.title,
            asset=asset,
            duration_ms=duration_ms,
            speakers=body.speakers,
            custom_emotions=body.custom_emotions,
            segments=body.segments,
        )

    async def _create_project_record(
        self,
        *,
        title: str,
        asset: AnnotationAudio,
        duration_ms: int,
        speakers: list[AudioAnnotationSpeaker],
        segments: list[AudioAnnotationSegment],
        custom_emotions: list[AudioAnnotationCustomEmotion] | None = None,
    ) -> AudioAnnotationProjectOut:
        project_id = new_id()
        prepared = None
        if self.references is not None:
            await self.session.rollback()
            prepared = await self.references.prepare(project_id, expected=-1, asset_ids=[asset.id])
        row = AudioAnnotationProject(
            id=project_id,
            owner_user_id=asset.owner_user_id,
            title=title,
            asset_id=asset.id,
            duration_ms=duration_ms,
        )
        self.session.add(row)
        try:
            await self.session.flush()
            self.session.add(
                AudioAnnotationDocument(
                    project_id=row.id,
                    schema_version="1.0",
                    speakers=[speaker.model_dump(mode="json") for speaker in speakers],
                    custom_emotions=[
                        emotion.model_dump(mode="json") for emotion in (custom_emotions or [])
                    ],
                    segments=[segment.model_dump(mode="json") for segment in segments],
                )
            )
            self.session.add(
                AudioAnnotationWaveform(project_id=row.id, duration_ms=duration_ms, peaks=[])
            )
            await self.session.flush()
            output = await self._project_out(row, asset)
            if prepared is not None:
                await self.references.record(self.session, prepared, resource_revision=0)
        except BaseException:
            await self.session.rollback()
            if prepared is not None:
                await self.references.abort(self.session, prepared)
            raise
        await self.session.commit()
        return output

    def _transcription_document(
        self,
        *,
        text: str,
        segments: list[AudioAnnotationTranscriptionSegmentIn],
        duration_ms: int,
    ) -> tuple[list[AudioAnnotationSpeaker], list[AudioAnnotationSegment]]:
        if not segments:
            complete_text = text.strip()
            if not complete_text:
                raise AudioAnnotationError(
                    "识别结果没有可导入的文本或时间戳片段",
                    code="transcription_empty",
                )
            try:
                converted = [
                    AudioAnnotationSegment(
                        id=new_id(),
                        start_ms=0,
                        end_ms=duration_ms,
                        speaker_id=None,
                        text=complete_text,
                        status="draft",
                    )
                ]
            except ValidationError as exc:
                raise AudioAnnotationError(
                    "识别全文超过单个标注片段允许的长度",
                    code="transcription_text_too_long",
                ) from exc
            document = AudioAnnotationImportIn(
                title="识别导入校验",
                asset_id="validation",
                schema_version="1.0",
                speakers=[],
                segments=converted,
            )
            self._validate_document(duration_ms, document)
            return [], converted

        ordered = sorted(
            (
                item
                for item in segments
                if item.end_ms < item.start_ms or item.end_ms - item.start_ms >= MIN_SEGMENT_MS
            ),
            key=lambda item: (item.start_ms, item.end_ms),
        )
        speakers: list[AudioAnnotationSpeaker] = []
        speaker_ids: dict[str, str] = {}
        converted: list[AudioAnnotationSegment] = []
        for item in ordered:
            label = item.speaker.strip()
            normalized_label = label.casefold()
            speaker_id: str | None = None
            if label and normalized_label != "unknown":
                speaker_id = speaker_ids.get(normalized_label)
                if speaker_id is None:
                    if len(speakers) >= 64:
                        raise AudioAnnotationError(
                            "识别结果中的说话人超过 64 个",
                            code="too_many_speakers",
                        )
                    speaker_id = new_id()
                    speaker_ids[normalized_label] = speaker_id
                    speakers.append(
                        AudioAnnotationSpeaker(
                            id=speaker_id,
                            name=label,
                            color=TRANSCRIPTION_SPEAKER_COLORS[
                                len(speakers) % len(TRANSCRIPTION_SPEAKER_COLORS)
                            ],
                        )
                    )
            try:
                converted.append(
                    AudioAnnotationSegment(
                        id=new_id(),
                        start_ms=item.start_ms,
                        end_ms=item.end_ms,
                        speaker_id=speaker_id,
                        text=item.text,
                        status="draft",
                    )
                )
            except ValidationError as exc:
                raise AudioAnnotationError(
                    "识别结果包含无效的时间戳或片段内容",
                    code="transcription_segments_invalid",
                ) from exc
        document = AudioAnnotationImportIn(
            title="识别导入校验",
            asset_id="validation",
            schema_version="1.0",
            speakers=speakers,
            segments=converted,
        )
        self._validate_document(duration_ms, document)
        return speakers, converted

    async def import_transcription(
        self, body: AudioAnnotationTranscriptionImportIn
    ) -> AudioAnnotationProjectOut:
        if body.source_kind == "json":
            asset = await self._asset(body.asset_id)
            duration_ms = await self._duration(asset)
            return await self._from_transcription(
                asset, body.title, body.text, body.segments, duration_ms
            )

        async with self.sources.transcription(body.task_id) as source:
            title = (body.title or Path(source.filename).stem.strip() or "录音标注")[:120]
            try:
                segments = [
                    AudioAnnotationTranscriptionSegmentIn.model_validate(item)
                    for item in source.segments
                ]
            except ValidationError as exc:
                raise AudioAnnotationError(
                    "识别任务的分段数据格式无效", code="transcription_segments_invalid"
                ) from exc
            if source.asset is not None:
                duration_ms = await self._duration(source.asset)
                return await self._from_transcription(
                    source.asset, title, source.text, segments, duration_ms
                )

            duration_ms = await self._measure_duration(source.original)
            speakers, converted = self._transcription_document(
                text=source.text, segments=segments, duration_ms=duration_ms
            )
            asset = await self.sources.publish_original(source)
            return await self._create_project_record(
                title=title,
                asset=asset,
                duration_ms=duration_ms,
                speakers=speakers,
                segments=converted,
            )

    async def _from_transcription(self, asset, title, text, segments, duration_ms):
        speakers, converted = self._transcription_document(
            text=text, segments=segments, duration_ms=duration_ms
        )
        return await self._create_project_record(
            title=title, asset=asset, duration_ms=duration_ms, speakers=speakers, segments=converted
        )

    async def patch(
        self, project_id: str, body: AudioAnnotationProjectPatchIn
    ) -> AudioAnnotationProjectOut:
        await self._project(project_id)
        result = await self.session.execute(
            update(AudioAnnotationProject)
            .where(
                AudioAnnotationProject.id == project_id,
                AudioAnnotationProject.revision == body.expected_revision,
            )
            .values(
                title=body.title,
                revision=body.expected_revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get(project_id)
            raise RevisionConflictError(
                body.expected_revision, current.revision, current.model_dump(mode="json")
            )
        await self.session.commit()
        return await self.get(project_id)

    async def delete(self, project_id: str, expected_revision: int) -> None:
        project = await self._project(project_id)
        owner_user_id = project.owner_user_id
        if project.revision != expected_revision:
            current = await self.get(project_id)
            raise RevisionConflictError(
                expected_revision, current.revision, current.model_dump(mode="json")
            )
        prepared = None
        if self.references is not None:
            await self.session.rollback()
            prepared = await self.references.prepare(
                project_id, expected=expected_revision, asset_ids=[]
            )
        try:
            await self._delete(project_id, owner_user_id, expected_revision)
            if prepared is not None:
                await self.references.record(
                    self.session, prepared, resource_revision=expected_revision + 1, deleted=True
                )
        except BaseException:
            await self.session.rollback()
            if prepared is not None:
                await self.references.abort(self.session, prepared)
            raise
        await self.session.commit()

    async def _delete(self, project_id, owner_user_id, expected_revision):
        result = await self.session.execute(
            delete(AudioAnnotationProject).where(
                AudioAnnotationProject.id == project_id,
                AudioAnnotationProject.revision == expected_revision,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get(project_id)
            raise RevisionConflictError(
                expected_revision, current.revision, current.model_dump(mode="json")
            )
        await forget(
            self.session, owner_user_id=owner_user_id, kind="annotation", resource_id=project_id
        )

    async def get_document(self, project_id: str) -> AudioAnnotationDocumentOut:
        await self._project(project_id)
        row = await self.session.get(AudioAnnotationDocument, project_id)
        if row is None:
            raise AudioAnnotationError("标注文档不存在", code="project_corrupt", status=500)
        return self._document_out(row)

    async def put_document(
        self, project_id: str, body: AudioAnnotationDocumentPutIn, *, commit: bool = True
    ) -> AudioAnnotationDocumentOut:
        project = await self._project(project_id)
        self._validate_document(project.duration_ms, body)
        result = await self.session.execute(
            update(AudioAnnotationDocument)
            .where(
                AudioAnnotationDocument.project_id == project_id,
                AudioAnnotationDocument.revision == body.expected_revision,
            )
            .values(
                schema_version=body.schema_version,
                speakers=[speaker.model_dump(mode="json") for speaker in body.speakers],
                custom_emotions=[
                    emotion.model_dump(mode="json") for emotion in body.custom_emotions
                ],
                segments=[segment.model_dump(mode="json") for segment in body.segments],
                revision=body.expected_revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get_document(project_id)
            raise RevisionConflictError(
                body.expected_revision, current.revision, current.model_dump(mode="json")
            )
        project.updated_at = utc_now()
        if commit:
            await self.session.commit()
        return await self.get_document(project_id)

    async def get_waveform(self, project_id: str) -> AudioAnnotationWaveformOut:
        await self._project(project_id)
        row = await self.session.get(AudioAnnotationWaveform, project_id)
        if row is None:
            raise AudioAnnotationError("波形数据不存在", code="project_corrupt", status=500)
        return self._waveform_out(row)

    async def put_waveform(
        self, project_id: str, body: AudioAnnotationWaveformPutIn
    ) -> AudioAnnotationWaveformOut:
        project = await self._project(project_id)
        if abs(body.duration_ms - project.duration_ms) > 100:
            raise AudioAnnotationError("波形时长与音频不一致", code="waveform_duration_mismatch")
        result = await self.session.execute(
            update(AudioAnnotationWaveform)
            .where(
                AudioAnnotationWaveform.project_id == project_id,
                AudioAnnotationWaveform.revision == body.expected_revision,
            )
            .values(
                duration_ms=project.duration_ms,
                peaks=body.peaks,
                revision=body.expected_revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get_waveform(project_id)
            raise RevisionConflictError(
                body.expected_revision, current.revision, current.model_dump(mode="json")
            )
        await self.session.commit()
        return await self.get_waveform(project_id)
