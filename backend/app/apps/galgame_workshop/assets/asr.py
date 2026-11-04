from __future__ import annotations

import asyncio

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.apps.galgame_workshop.assets.asr_records import AsrRecords, _task_out
from app.apps.galgame_workshop.assets.transcript_records import write_transcript
from app.apps.galgame_workshop.assets.voice_matching import match_dialogue
from app.apps.galgame_workshop.models import (
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameAssetTranscriptionTask,
)
from app.apps.galgame_workshop.schemas import (
    GalgameStoryDocumentPutIn,
    GalgameTranscriptionCreateIn,
    GalgameTranscriptionTaskListOut,
    GalgameTranscriptPatchIn,
    GalgameVoiceMatchIn,
    GalgameVoiceMatchOut,
)
from app.apps.galgame_workshop.story.story import GalgameStoryDocuments
from app.capabilities.asset_store import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.llm.models import (
    ModelEntry,
    ModelProvider,
)
from app.llm.providers._senseaudio import SenseAudioProviderError
from app.llm.providers.senseaudio_asr import (
    SenseAudioAsrFileTooLarge,
)
from app.llm.providers.transcription import transcribe_model_audio
from app.llm.transcription_catalog import supports_asr, transcription_model_ready
from app.runtime.config import Settings, get_settings
from app.runtime.credentials import decrypt_secret
from app.runtime.db import SessionLocal
from app.runtime.ownership import bind_owner
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.task_admission import TaskAdmission
from app.runtime.time import utc_now


class GalgameAsrService(AsrRecords):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, lambda model_id: transcription_model_ready(session, model_id))

    async def create_tasks(
        self,
        project_id: str,
        body: GalgameTranscriptionCreateIn,
        *,
        admission: TaskAdmission | None = None,
    ) -> GalgameTranscriptionTaskListOut:
        settings = await self._settings(project_id)
        model = (
            await self.session.get(ModelEntry, settings.asr_model_id)
            if settings.asr_model_id
            else None
        )
        provider = (
            await self.session.get(ModelProvider, model.provider_id) if model is not None else None
        )
        if model is None or not supports_asr(model, provider):
            raise AssetError("语音识别模型尚未就绪", code="asr_model_unavailable")
        query = (
            select(VisualAsset, GalgameAssetMetadata)
            .join(GalgameAssetMetadata, GalgameAssetMetadata.asset_id == VisualAsset.id)
            .where(
                VisualAsset.galgame_project_id == project_id,
                VisualAsset.media_kind == "audio",
                GalgameAssetMetadata.category == "voice",
            )
        )
        if body.asset_ids is not None:
            query = query.where(VisualAsset.id.in_(body.asset_ids))
        rows = (await self.session.execute(query.order_by(VisualAsset.display_name))).all()
        tasks: list[GalgameAssetTranscriptionTask] = []
        for asset, metadata in rows:
            if not body.force and metadata.transcript_status == "ready":
                continue
            task = GalgameAssetTranscriptionTask(
                owner_user_id=asset.owner_user_id,
                project_id=project_id,
                asset_id=asset.id,
                provider_id=provider.id,
                provider_name=provider.name,
                model_id=model.id,
                model_slug=model.slug,
                language=body.language or settings.default_language,
                force=body.force,
            )
            metadata.transcript_status = "queued"
            self.session.add(task)
            tasks.append(task)
        await self.session.flush()
        if admission:
            await admission([task.id for task in tasks])
        await self.session.commit()
        for task in tasks:
            await self.session.refresh(task)
        return GalgameTranscriptionTaskListOut(items=[_task_out(task) for task in tasks])

    async def patch_transcript(
        self, project_id: str, asset_id: str, body: GalgameTranscriptPatchIn
    ) -> object:
        await self._project(project_id)
        metadata = await self.session.get(GalgameAssetMetadata, asset_id)
        asset = await self.session.get(VisualAsset, asset_id)
        if (
            metadata is None
            or asset is None
            or metadata.project_id != project_id
            or asset.media_kind != "audio"
        ):
            raise AssetError("语音素材不存在", code="not_found", status=404)
        return await write_transcript(self.session, metadata, asset_id, body)

    async def match_dialogue(
        self, project_id: str, body: GalgameVoiceMatchIn
    ) -> GalgameVoiceMatchOut:
        story = await GalgameStoryDocuments(self.session).get(project_id)
        query = (
            select(VisualAsset, GalgameAssetMetadata)
            .join(GalgameAssetMetadata, GalgameAssetMetadata.asset_id == VisualAsset.id)
            .where(
                VisualAsset.galgame_project_id == project_id,
                GalgameAssetMetadata.category == "voice",
                GalgameAssetMetadata.transcript_status == "ready",
            )
        )
        if body.asset_ids is not None:
            query = query.where(VisualAsset.id.in_(body.asset_ids))
        voice_rows = (await self.session.execute(query.order_by(VisualAsset.display_name))).all()
        payload, matches, unmatched = match_dialogue(story.document, voice_rows, body)
        saved = await GalgameStoryDocuments(self.session).put(
            project_id,
            GalgameStoryDocumentPutIn.model_validate(
                {
                    "expected_revision": body.expected_story_revision,
                    "document": payload,
                }
            ),
        )
        return GalgameVoiceMatchOut(
            storyRevision=saved.revision,
            matches=matches,
            unmatchedAssetIds=unmatched,
        )


class GalgameAsrRunner(PollingTaskRunner):
    runner_name = "galgame-asr-runner"

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] = SessionLocal,
        settings: Settings | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)
        self.transport = transport

    async def _load_task(
        self, session: AsyncSession, task_id: str
    ) -> GalgameAssetTranscriptionTask | None:
        task = await session.get(GalgameAssetTranscriptionTask, task_id)
        if task is not None:
            bind_owner(session, task.owner_user_id)
        return task

    async def recover(self) -> None:
        async with self.session_factory() as session:
            interrupted = list(
                (
                    await session.execute(
                        select(GalgameAssetTranscriptionTask).where(
                            GalgameAssetTranscriptionTask.status == "running"
                        )
                    )
                )
                .scalars()
                .all()
            )
            for task in interrupted:
                task.status = "failed"
                task.error = "应用在识别请求期间中断；为避免重复计费，请手动重新识别"
                task.finished_at = utc_now()
                task.revision += 1
            await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            tasks = list(
                (
                    await session.execute(
                        select(GalgameAssetTranscriptionTask)
                        .where(GalgameAssetTranscriptionTask.status == "queued")
                        .order_by(GalgameAssetTranscriptionTask.created_at)
                        .limit(32)
                    )
                )
                .scalars()
                .all()
            )
            settings_by_project = {
                task.project_id: await session.get(GalgameAssetSettings, task.project_id)
                for task in tasks
            }
        semaphores = {
            project_id: asyncio.Semaphore(settings.concurrency if settings else 1)
            for project_id, settings in settings_by_project.items()
        }

        async def guarded(task: GalgameAssetTranscriptionTask) -> None:
            async with semaphores[task.project_id]:
                await self._process_task(task.id)

        await asyncio.gather(*(guarded(task) for task in tasks))

    async def _process_task(self, task_id: str) -> None:
        try:
            async with self.session_factory() as session:
                task = await self._load_task(session, task_id)
                if task is None or task.status != "queued":
                    return
                asset = await session.get(VisualAsset, task.asset_id)
                provider = (
                    await session.get(ModelProvider, task.provider_id) if task.provider_id else None
                )
                model = await session.get(ModelEntry, task.model_id) if task.model_id else None
                metadata = await session.get(GalgameAssetMetadata, task.asset_id)
                if (
                    asset is None
                    or metadata is None
                    or model is None
                    or not supports_asr(model, provider)
                ):
                    task.status = "failed"
                    task.error = "素材、供应商或模型已不可用"
                    task.finished_at = utc_now()
                    task.revision += 1
                    if metadata is not None:
                        metadata.transcript_status = "failed"
                    await session.commit()
                    return
                if provider is None or not provider.api_key_ciphertext:
                    task.status = "failed"
                    task.error = "供应商缺少 API Key"
                    task.finished_at = utc_now()
                    task.revision += 1
                    metadata.transcript_status = "failed"
                    await session.commit()
                    return
                task.status = "running"
                task.started_at = utc_now()
                task.revision += 1
                metadata.transcript_status = "running"
                base_url = provider.base_url.rstrip("/")
                api_key = decrypt_secret(provider.api_key_ciphertext)
                model_slug = task.model_slug
                language = task.language
                filename = asset.original_filename
                file_path = self.storage.path_for(asset)
                mime_type = asset.mime_type
                force = task.force
                provider_kind = provider.kind
                byte_size = asset.byte_size
                await session.commit()

            with file_path.open("rb") as source:
                transcription = await transcribe_model_audio(
                    provider_kind=provider_kind,
                    base_url=base_url,
                    api_key=api_key,
                    model=model_slug,
                    filename=filename,
                    source=source,
                    mime_type=mime_type,
                    byte_size=byte_size,
                    language=language,
                    transport=self.transport,
                )
            text = transcription.text
            segments = [
                {
                    "speaker": segment.speaker,
                    "startMs": segment.start_ms,
                    "endMs": segment.end_ms,
                    "text": segment.text,
                }
                for segment in transcription.segments
            ]
            async with self.session_factory() as session:
                task = await self._load_task(session, task_id)
                metadata = await session.get(GalgameAssetMetadata, task.asset_id) if task else None
                if task is None or metadata is None:
                    return
                task.status = "completed"
                task.result_text = text
                task.result_segments = segments
                task.error = None
                task.finished_at = utc_now()
                task.revision += 1
                if force or metadata.transcript_source != "manual":
                    metadata.transcript = text.strip()
                    metadata.transcript_language = language
                    metadata.transcript_source = "asr"
                    metadata.transcript_revision += 1
                    metadata.transcript_segments = segments
                metadata.transcript_status = "ready"
                await session.commit()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            async with self.session_factory() as session:
                task = await self._load_task(session, task_id)
                if task is None:
                    return
                metadata = await session.get(GalgameAssetMetadata, task.asset_id)
                task.status = "failed"
                task.error = (
                    str(exc)
                    if isinstance(exc, SenseAudioAsrFileTooLarge)
                    else "语音识别请求超时"
                    if isinstance(exc, httpx.TimeoutException)
                    else str(exc)
                    if isinstance(exc, SenseAudioProviderError)
                    else f"语音识别失败（{type(exc).__name__}）"
                )
                task.finished_at = utc_now()
                task.revision += 1
                if metadata is not None:
                    metadata.transcript_status = "failed"
                await session.commit()
