from __future__ import annotations

import asyncio
import re
import unicodedata
from difflib import SequenceMatcher

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.apps.galgame_workshop.models import (
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameAssetTranscriptionTask,
    GalgameWorkshopProject,
)
from app.apps.galgame_workshop.schemas import (
    GalgameAsrSettingsOut,
    GalgameAsrSettingsPatchIn,
    GalgameStoryDocumentPutIn,
    GalgameTranscriptionCreateIn,
    GalgameTranscriptionTaskListOut,
    GalgameTranscriptionTaskOut,
    GalgameTranscriptPatchIn,
    GalgameVoiceMatchIn,
    GalgameVoiceMatchItem,
    GalgameVoiceMatchOut,
)
from app.apps.galgame_workshop.story.story import GalgameStoryDocuments
from app.capabilities.asset_store import AssetError
from app.capabilities.asset_store.storage import AssetStorage
from app.llm.providers._senseaudio import SenseAudioProviderError
from app.llm.providers.senseaudio_asr import (
    SenseAudioAsrFileTooLarge,
)
from app.llm.providers.transcription import transcribe_model_audio
from app.models import (
    ModelEntry,
    ModelProvider,
    VisualAsset,
)
from app.orm import bind_workspace
from app.runtime.config import Settings, get_settings
from app.runtime.credentials import decrypt_secret
from app.runtime.db import SessionLocal
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.revisions import RevisionConflictError
from app.runtime.task_admission import TaskAdmission
from app.runtime.time import iso_utc, utc_now


def _task_out(row: GalgameAssetTranscriptionTask) -> GalgameTranscriptionTaskOut:
    return GalgameTranscriptionTaskOut(
        id=row.id,
        assetId=row.asset_id,
        providerName=row.provider_name,
        modelSlug=row.model_slug,
        language=row.language,
        force=row.force,
        status=row.status,
        resultText=row.result_text,
        resultSegments=list(row.result_segments or []),
        error=row.error,
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        startedAt=iso_utc(row.started_at) if row.started_at else None,
        finishedAt=iso_utc(row.finished_at) if row.finished_at else None,
    )


def _model_supports_asr(model: ModelEntry, provider: ModelProvider | None) -> bool:
    return bool(
        provider is not None
        and provider.kind in {"openai", "senseaudio_asr", "senseaudio_asr_pro"}
        and provider.enabled
        and model.enabled
        and (
            "speech_recognition" in list(model.capabilities or [])
            or "speech_recognition" in list(model.categories or [])
        )
    )


class GalgameAsrService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _project(self, project_id: str) -> None:
        if await self.session.get(GalgameWorkshopProject, project_id) is None:
            raise AssetError("项目不存在", code="not_found", status=404)

    async def _settings(self, project_id: str) -> GalgameAssetSettings:
        await self._project(project_id)
        row = await self.session.get(GalgameAssetSettings, project_id)
        if row is None:
            row = GalgameAssetSettings(project_id=project_id)
            self.session.add(row)
            await self.session.commit()
            await self.session.refresh(row)
        return row

    async def _settings_out(self, row: GalgameAssetSettings) -> GalgameAsrSettingsOut:
        model = await self.session.get(ModelEntry, row.asr_model_id) if row.asr_model_id else None
        provider = (
            await self.session.get(ModelProvider, model.provider_id) if model is not None else None
        )
        return GalgameAsrSettingsOut(
            modelId=row.asr_model_id,
            modelReady=bool(model and _model_supports_asr(model, provider)),
            defaultLanguage=row.default_language,
            concurrency=row.concurrency,
            revision=row.revision,
        )

    async def get_settings(self, project_id: str) -> GalgameAsrSettingsOut:
        return await self._settings_out(await self._settings(project_id))

    async def patch_settings(
        self, project_id: str, body: GalgameAsrSettingsPatchIn
    ) -> GalgameAsrSettingsOut:
        await self._settings(project_id)
        if body.model_id is not None:
            model = await self.session.get(ModelEntry, body.model_id)
            provider = (
                await self.session.get(ModelProvider, model.provider_id)
                if model is not None
                else None
            )
            if model is None or not _model_supports_asr(model, provider):
                raise AssetError(
                    "只能选择已启用的 OpenAI 兼容或 SenseAudio 语音识别模型",
                    code="asr_model_unavailable",
                )
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
            "updated_at": utc_now(),
        }
        if "model_id" in body.model_fields_set:
            values["asr_model_id"] = body.model_id
        if body.default_language is not None:
            values["default_language"] = body.default_language
        if body.concurrency is not None:
            values["concurrency"] = body.concurrency
        result = await self.session.execute(
            update(GalgameAssetSettings)
            .where(
                GalgameAssetSettings.project_id == project_id,
                GalgameAssetSettings.revision == body.expected_revision,
            )
            .values(**values)
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self._settings(project_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                (await self._settings_out(current)).model_dump(mode="json", by_alias=True),
            )
        await self.session.commit()
        return await self._settings_out(await self._settings(project_id))

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
        if model is None or not _model_supports_asr(model, provider):
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

    async def list_tasks(self, project_id: str) -> GalgameTranscriptionTaskListOut:
        await self._project(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(GalgameAssetTranscriptionTask)
                    .where(GalgameAssetTranscriptionTask.project_id == project_id)
                    .order_by(GalgameAssetTranscriptionTask.created_at.desc())
                    .limit(500)
                )
            )
            .scalars()
            .all()
        )
        return GalgameTranscriptionTaskListOut(items=[_task_out(row) for row in rows])

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
        result = await self.session.execute(
            update(GalgameAssetMetadata)
            .where(
                GalgameAssetMetadata.asset_id == asset_id,
                GalgameAssetMetadata.transcript_revision == body.expected_revision,
            )
            .values(
                transcript=body.text.strip(),
                transcript_language=body.language or metadata.transcript_language,
                transcript_status="ready",
                transcript_source="manual",
                transcript_revision=body.expected_revision + 1,
                transcript_segments=[],
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.session.get(GalgameAssetMetadata, asset_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.transcript_revision if current else 0,
                {"assetId": asset_id, "transcript": current.transcript if current else None},
            )
        await self.session.commit()
        await self.session.refresh(metadata)
        return {
            "assetId": asset_id,
            "transcript": metadata.transcript,
            "language": metadata.transcript_language,
            "source": metadata.transcript_source,
            "revision": metadata.transcript_revision,
        }

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
        payload = story.document.model_dump(mode="json", by_alias=True)
        dialogue_blocks: list[tuple[dict[str, object], str]] = []
        for chapter in payload["chapters"]:
            for fragment in chapter["fragments"]:
                for block in fragment["blocks"]:
                    if block.get("type") == "dialogue" and str(block.get("text", "")).strip():
                        dialogue_blocks.append((block, str(block["text"])))
        story_asset_by_file = {
            asset["fileId"]: asset for asset in payload["assets"] if asset["type"] == "audio"
        }
        requested_block_ids = set(body.block_ids) if body.block_ids is not None else None
        candidates: list[tuple[float, str, str, dict[str, object], VisualAsset]] = []
        for asset, metadata in voice_rows:
            normalized_transcript = _normalized_text(metadata.transcript or "")
            if not normalized_transcript:
                continue
            for block, text in dialogue_blocks:
                if requested_block_ids is not None and str(block["id"]) not in requested_block_ids:
                    continue
                similarity = SequenceMatcher(
                    None, normalized_transcript, _normalized_text(text)
                ).ratio()
                if similarity >= body.minimum_similarity:
                    candidates.append(
                        (-similarity, asset.display_name.casefold(), str(block["id"]), block, asset)
                    )
        candidates.sort(key=lambda item: (item[0], item[1], item[2]))
        used_assets: set[str] = set()
        used_blocks: set[str] = set()
        matches: list[GalgameVoiceMatchItem] = []
        for negative_similarity, _filename, block_id, block, asset in candidates:
            if asset.id in used_assets or block_id in used_blocks:
                continue
            story_asset = story_asset_by_file.get(asset.id)
            if story_asset is None:
                story_asset = {
                    "id": f"voice-{asset.id}",
                    "type": "audio",
                    "role": "voiceLine",
                    "label": asset.display_name,
                    "fileId": asset.id,
                    "status": "ready",
                }
                payload["assets"].append(story_asset)
                story_asset_by_file[asset.id] = story_asset
            elif story_asset.get("role") != "voiceLine":
                continue
            block["voiceAssetId"] = story_asset["id"]
            used_assets.add(asset.id)
            used_blocks.add(block_id)
            matches.append(
                GalgameVoiceMatchItem(
                    assetId=asset.id,
                    blockId=block_id,
                    similarity=round(-negative_similarity, 6),
                )
            )
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
            unmatchedAssetIds=[
                asset.id for asset, _metadata in voice_rows if asset.id not in used_assets
            ],
        )


def _normalized_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[\W_]+", "", normalized, flags=re.UNICODE)


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
            bind_workspace(session, task.workspace_id)
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
                    or not _model_supports_asr(model, provider)
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
