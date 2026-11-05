from __future__ import annotations

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.audio_annotation.models import (
    AudioAnnotationDocument,
    AudioAnnotationProject,
    AudioAnnotationWaveform,
)
from studio.apps.audio_annotation.ports import AudioSources
from studio.apps.audio_annotation.rules.audio import require_audio
from studio.apps.audio_annotation.rules.documents import validate_document
from studio.apps.audio_annotation.schemas.document import (
    AudioAnnotationCustomEmotion,
    AudioAnnotationDocumentOut,
    AudioAnnotationDocumentPutIn,
    AudioAnnotationProjectListOut,
    AudioAnnotationProjectOut,
    AudioAnnotationProjectPatchIn,
    AudioAnnotationSegment,
    AudioAnnotationSpeaker,
    AudioAnnotationWaveformOut,
    AudioAnnotationWaveformPutIn,
)
from studio.apps.audio_annotation.sources import AnnotationAudio
from studio.apps.audio_annotation.sources import AudioAnnotationError as AudioAnnotationError
from studio.runtime.database.operation_receipts import forget
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import iso_utc, utc_now


class ProjectRecords:
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
        return require_audio(await self.sources.describe(asset_id))

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

    async def commit_creation(
        self,
        *,
        project_id: str,
        title: str,
        asset: AnnotationAudio,
        duration_ms: int,
        speakers: list[AudioAnnotationSpeaker],
        segments: list[AudioAnnotationSegment],
        custom_emotions: list[AudioAnnotationCustomEmotion] | None = None,
    ) -> AudioAnnotationProjectOut:
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
        validate_document(project.duration_ms, body)
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
