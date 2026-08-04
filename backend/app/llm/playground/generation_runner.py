from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.credentials import decrypt_secret
from app.core.db import SessionLocal
from app.core.time import utc_now
from app.llm.generation_runtime import (
    GenerationMaterializationError,
    PollingGenerationRunner,
    assert_public_https,
    download_generated_media,
    generated_type,
    read_data_uri,
)
from app.llm.playground.generation import ACTIVE_GENERATION_STATUSES
from app.llm.providers import create_image_task, create_video_task, get_image_task, get_video_task
from app.llm.providers._senseaudio import SenseAudioProviderError, sanitize_provider_message
from app.llm.providers.temporary_media import TemporaryMediaError, upload_temporary_media
from app.models import (
    LlmCallLog,
    ModelProvider,
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
    VisualAsset,
)

ModelTestMaterializationError = GenerationMaterializationError
_assert_public_https = assert_public_https
_generated_type = generated_type


def _safe_error(exc: Exception) -> str:
    if isinstance(exc, TemporaryMediaError):
        return "参考素材临时上传失败，请重新生成"
    if isinstance(exc, (ModelTestMaterializationError, SenseAudioProviderError, ValueError)):
        return sanitize_provider_message(str(exc))
    if isinstance(exc, httpx.TimeoutException):
        return "SenseAudio 请求超时"
    return f"任务处理失败（{type(exc).__name__}）"


class ModelTestGenerationRunner(PollingGenerationRunner):
    runner_name = "model-test-generation-runner"

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] = SessionLocal,
        settings: Settings | None = None,
        download_transport: httpx.AsyncBaseTransport | None = None,
        temporary_media_transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.settings = settings or get_settings()
        self.download_transport = download_transport
        self.temporary_media_transport = temporary_media_transport

    async def recover(self) -> None:
        async with self.session_factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(ModelTestGenerationTask).where(
                            ModelTestGenerationTask.status == "submitting"
                        )
                    )
                )
                .scalars()
                .all()
            )
            for row in rows:
                row.status = "failed"
                row.error_message = "应用在提交供应商任务期间中断；为避免重复计费，请重新生成"
                row.revision += 1
                row.updated_at = utc_now()
                self._add_log(session, row)
            await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            task_ids = list(
                (
                    await session.execute(
                        select(ModelTestGenerationTask.id)
                        .where(ModelTestGenerationTask.status.in_(ACTIVE_GENERATION_STATUSES))
                        .order_by(ModelTestGenerationTask.updated_at)
                        .limit(40)
                    )
                )
                .scalars()
                .all()
            )

        await self.run_concurrently(task_ids, self._process_task)

    async def _process_task(self, task_id: str) -> None:
        try:
            async with self.session_factory() as session:
                task = await session.get(ModelTestGenerationTask, task_id)
                if task is None or task.status not in ACTIVE_GENERATION_STATUSES:
                    return
                if task.status == "submitting":
                    return
                if task.status == "processing" and task.result_url:
                    result_url = task.result_url
                    await session.rollback()
                    await self._materialize(task_id, result_url)
                    return
                provider = (
                    await session.get(ModelProvider, task.provider_id) if task.provider_id else None
                )
                if provider is None or not provider.enabled or not provider.api_key_ciphertext:
                    await session.rollback()
                    await self._fail(task_id, "供应商已停用、删除或缺少 API Key")
                    return
                base_url = provider.base_url
                api_key = decrypt_secret(provider.api_key_ciphertext)
                status = task.status
                provider_task_id = task.provider_task_id or ""
                payload = dict(task.request_payload or {})
                model_slug = task.model_slug
                provider_kind = task.provider_kind
                if status == "queued":
                    task.status = "submitting"
                    task.revision += 1
                    task.updated_at = utc_now()
                    await session.commit()
                else:
                    await session.rollback()

            if status == "queued":
                if provider_kind == "senseaudio_image":
                    provider_task_id = await create_image_task(
                        base_url=base_url,
                        api_key=api_key,
                        model=model_slug,
                        prompt=str(payload["prompt"]),
                        size=str(payload["size"]),
                        seed=payload.get("seed"),
                    )
                else:
                    content: list[dict[str, object]] = [
                        {"type": "text", "text": str(payload["prompt"])}
                    ]
                    for asset_id in payload.get("reference_asset_ids", []):
                        content.append(
                            {
                                "type": "image",
                                "url": await self._asset_data_uri(task_id, str(asset_id), "image"),
                                "role": "reference",
                            }
                        )
                    for asset_id in payload.get("audio_asset_ids", []):
                        content.append(
                            {
                                "type": "audio",
                                "audio_url": await self._temporary_asset_url(
                                    task_id, str(asset_id), "audio"
                                ),
                            }
                        )
                    for asset_id in payload.get("video_asset_ids", []):
                        content.append(
                            {
                                "type": "video",
                                "video_url": await self._temporary_asset_url(
                                    task_id, str(asset_id), "video"
                                ),
                            }
                        )
                    if len(str(content).encode("utf-8")) > 64 * 1024 * 1024:
                        raise ValueError("参考素材请求体超过 SenseAudio 的 64 MB 限制")
                    provider_task_id = await create_video_task(
                        base_url=base_url,
                        api_key=api_key,
                        model=model_slug,
                        content=content,
                        duration=int(payload["duration"]),
                        resolution=str(payload["resolution"]),
                        ratio=str(payload["ratio"]),
                        watermark=bool(payload["watermark"]),
                        generate_audio=bool(payload["generate_audio"]),
                    )
                async with self.session_factory() as session:
                    current = await session.get(ModelTestGenerationTask, task_id)
                    if current is None:
                        return
                    current.provider_task_id = provider_task_id
                    current.status = "pending"
                    current.progress = 0
                    current.error_message = None
                    current.revision += 1
                    current.updated_at = utc_now()
                    await session.commit()
                return

            provider_status = (
                await get_image_task(base_url=base_url, api_key=api_key, task_id=provider_task_id)
                if provider_kind == "senseaudio_image"
                else await get_video_task(
                    base_url=base_url, api_key=api_key, task_id=provider_task_id
                )
            )
            if provider_status.status == "failed":
                await self._fail(
                    task_id,
                    sanitize_provider_message(provider_status.error_message)
                    if provider_status.error_message
                    else "SenseAudio 生成任务失败",
                )
                return
            if provider_status.status == "completed":
                if not provider_status.result_url:
                    await self._fail(task_id, "SenseAudio 已完成任务但未返回结果地址")
                    return
                async with self.session_factory() as session:
                    current = await session.get(ModelTestGenerationTask, task_id)
                    if current is None:
                        return
                    current.status = "processing"
                    current.progress = 100
                    current.result_url = provider_status.result_url
                    current.revision += 1
                    current.updated_at = utc_now()
                    await session.commit()
                await self._materialize(task_id, provider_status.result_url)
                return
            async with self.session_factory() as session:
                current = await session.get(ModelTestGenerationTask, task_id)
                if current is None:
                    return
                current.status = (
                    "processing" if provider_status.status == "processing" else "pending"
                )
                current.progress = provider_status.progress
                current.revision += 1
                current.updated_at = utc_now()
                await session.commit()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._fail(task_id, _safe_error(exc))

    async def _asset_data_uri(self, task_id: str, asset_id: str, expected_kind: str) -> str:
        path, mime_type = await self._asset_path(task_id, asset_id, expected_kind)
        return await read_data_uri(path=path, mime_type=mime_type)

    async def _asset_path(
        self, task_id: str, asset_id: str, expected_kind: str
    ) -> tuple[Path, str]:
        async with self.session_factory() as session:
            private = await session.get(ModelTestGenerationAsset, asset_id)
            if private is not None:
                if private.task_id != task_id or private.media_kind != expected_kind:
                    raise ValueError("参考素材已不存在或类型不匹配")
                return (
                    self.settings.model_test_reference_path / private.storage_key,
                    private.mime_type,
                )
            has_private = await session.scalar(
                select(ModelTestGenerationAsset.id)
                .where(ModelTestGenerationAsset.task_id == task_id)
                .limit(1)
            )
            if has_private:
                raise ValueError("参考素材已不存在或类型不匹配")
            legacy = await session.get(VisualAsset, asset_id)
            if legacy is None or legacy.media_kind != expected_kind:
                raise ValueError("参考素材已不存在或类型不匹配")
            return self.settings.visual_asset_path / legacy.storage_key, legacy.mime_type

    async def _temporary_asset_url(self, task_id: str, asset_id: str, expected_kind: str) -> str:
        try:
            path, mime_type = await self._asset_path(task_id, asset_id, expected_kind)
        except ValueError as exc:
            raise TemporaryMediaError(str(exc)) from None
        return await upload_temporary_media(
            path=path,
            mime_type=mime_type,
            upload_url=self.settings.fpl_temp_media_upload_url,
            transport=self.temporary_media_transport,
        )

    async def _fail(self, task_id: str, message: str, *, result_url: str = "") -> None:
        async with self.session_factory() as session:
            row = await session.get(ModelTestGenerationTask, task_id)
            if row is None or row.status in {"completed", "failed"}:
                return
            row.status = "failed"
            row.error_message = message[:4000]
            if result_url:
                row.result_url = result_url
            row.revision += 1
            row.updated_at = utc_now()
            self._add_log(session, row)
            await session.commit()

    def _add_log(self, session: AsyncSession, row: ModelTestGenerationTask) -> None:
        if row.log_id:
            return
        latency_ms = max(0, round((utc_now() - row.created_at).total_seconds() * 1000))
        log_id = str(uuid4())
        log = LlmCallLog(
            id=log_id,
            call_source="model_playground",
            provider_kind=row.provider_kind,
            model=row.model_slug,
            trace_id=str(uuid4()),
            request_payload={"model": row.model_slug, **dict(row.request_payload or {})},
            response_payload={
                "status": row.status,
                "result_mime_type": row.result_mime_type,
                "result_byte_size": row.result_byte_size,
            },
            latency_ms=latency_ms,
            status="success" if row.status == "completed" else "error",
            error_message=row.error_message,
        )
        session.add(log)
        row.log_id = log_id

    async def _download(self, url: str, target: Path) -> tuple[int, str, str, str]:
        return await download_generated_media(
            url=url,
            target=target,
            max_bytes=self.settings.fpl_visual_asset_max_bytes,
            transport=self.download_transport,
        )

    async def _materialize(self, task_id: str, result_url: str) -> None:
        root = self.settings.model_test_generated_path
        temp_dir = root / ".tmp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        storage_key = uuid4().hex
        temp_path = temp_dir / storage_key
        final_path = root / storage_key
        try:
            size, media_kind, mime_type, extension = await self._download(result_url, temp_path)
            os.replace(temp_path, final_path)
            async with self.session_factory() as session:
                task = await session.get(ModelTestGenerationTask, task_id)
                if task is None:
                    final_path.unlink(missing_ok=True)
                    return
                if media_kind != task.generation_kind:
                    raise ModelTestMaterializationError("生成结果类型与任务类型不一致")
                task.result_storage_key = storage_key
                task.result_filename = f"{task.model_slug}-{task.id[:8]}{extension}"
                task.result_mime_type = mime_type
                task.result_byte_size = size
                task.status = "completed"
                task.progress = 100
                task.error_message = None
                task.completed_at = utc_now()
                task.updated_at = task.completed_at
                task.revision += 1
                self._add_log(session, task)
                await session.commit()
        except Exception as exc:
            temp_path.unlink(missing_ok=True)
            final_path.unlink(missing_ok=True)
            await self._fail(task_id, _safe_error(exc), result_url=result_url)
