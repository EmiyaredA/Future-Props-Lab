from __future__ import annotations

import asyncio
import os
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from studio.apps.model_service.call_logs.record_attribution import snapshot_from_row
from studio.apps.model_service.generation.driver import (
    GenerationTaskContext,
    GenerationTaskDriver,
    GenerationTaskStore,
    ImmediateGenerationResult,
)
from studio.apps.model_service.generation.media import (
    GenerationMaterializationError,
    assert_public_https,
    download_generated_media,
    generated_type,
    read_data_uri,
)
from studio.apps.model_service.generation.provider_tasks import (
    poll_generation_task,
    safe_generation_error,
    submit_generation_task,
    upload_temporary_reference,
)
from studio.apps.model_service.playground.generation import ACTIVE_GENERATION_STATUSES
from studio.apps.model_service.providers.temporary_media import TemporaryMediaError
from studio.apps.model_service.providers.zealman_live import ZealmanLiveMonitor
from studio.apps.model_service.providers.zealman_video import (
    create_task,
    get_task,
    upload_reference,
)
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_test import (
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
)
from studio.config.settings import Settings
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now

ModelTestMaterializationError = GenerationMaterializationError
_assert_public_https = assert_public_https
_generated_type = generated_type


def _safe_error(exc: Exception) -> str:
    return safe_generation_error(exc)


class ModelTestGenerationRunner(PollingTaskRunner):
    runner_name = "model-test-generation-runner"

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        download_transport: httpx.AsyncBaseTransport | None = None,
        temporary_media_transport: httpx.AsyncBaseTransport | None = None,
        *,
        decrypt: Callable[[str], str],
        legacy_references=None,
        prepare_claim=None,
        terminal_settlement=None,
    ) -> None:
        super().__init__()
        self.zealman_monitor = ZealmanLiveMonitor()
        self.session_factory = session_factory
        self.settings = settings
        self.legacy_references = legacy_references
        self.terminal_settlement = terminal_settlement
        self.download_transport = download_transport
        self.temporary_media_transport = temporary_media_transport
        self.task_store = GenerationTaskStore(
            session_factory=self.session_factory,
            task_type=ModelTestGenerationTask,
            active_statuses=ACTIVE_GENERATION_STATUSES,
            task_subject="model generation task",
            terminal_hook=self._add_log,
            prepare_claim=prepare_claim,
            terminal_settlement=terminal_settlement,
            decrypt=decrypt,
        )
        self.task_driver = GenerationTaskDriver(
            store=self.task_store,
            submit=self._submit_context,
            poll=self._poll_context,
            materialize=self._materialize,
            map_error=_safe_error,
            provider_failure_message="供应商生成任务失败",
            missing_result_message="供应商已完成任务但未返回结果地址",
        )

    async def _load_task(
        self, session: AsyncSession, task_id: str
    ) -> ModelTestGenerationTask | None:
        return await self.task_store.load(session, task_id)

    async def stop(self) -> None:
        await super().stop()
        await self.zealman_monitor.close()

    async def recover(self) -> None:
        await self.task_driver.recover()

    async def process_once(self) -> None:
        task_ids = await self.task_store.active_task_ids()
        await self.run_concurrently(task_ids, self._process_task)

    async def _process_task(self, task_id: str) -> None:
        await self.task_driver.process(task_id)

    async def _submit_context(self, task: GenerationTaskContext) -> str | ImmediateGenerationResult:
        if task.provider_kind == "zealman_video":
            references: dict[str, list[str]] = {}
            for kind, field in (
                ("image", "reference_asset_ids"),
                ("audio", "audio_asset_ids"),
                ("video", "video_asset_ids"),
            ):
                references[kind] = []
                for asset_id in task.payload.get(field, []):
                    path, mime_type = await self._asset_path(task.task_id, str(asset_id), kind)
                    references[kind].append(
                        await upload_reference(
                            base_url=task.base_url,
                            api_key=task.api_key,
                            path=path,
                            mime_type=mime_type,
                        )
                    )
            return await create_task(
                base_url=task.base_url,
                api_key=task.api_key,
                model=task.model_slug,
                payload=task.payload,
                references=references,
            )
        if task.provider_kind in {"senseaudio_image", "volcengine_image"}:
            return await submit_generation_task(
                provider_kind=task.provider_kind,
                base_url=task.base_url,
                api_key=task.api_key,
                model_slug=task.model_slug,
                payload=task.payload,
            )
        content: list[dict[str, object]] = [
            {"type": "text", "text": str(task.payload.get("prompt", ""))}
        ]
        for field, role in (
            ("first_frame_asset_id", "first_frame"),
            ("last_frame_asset_id", "last_frame"),
        ):
            if task.payload.get(field):
                content.append(
                    {
                        "type": "image",
                        "url": await self._asset_data_uri(
                            task.task_id, task.payload[field], "image"
                        ),
                        "role": role,
                    }
                )
        for asset_id in task.payload.get("reference_asset_ids", []):
            content.append(
                {
                    "type": "image",
                    "url": await self._asset_data_uri(task.task_id, str(asset_id), "image"),
                    "role": "reference",
                }
            )
        for asset_id in task.payload.get("audio_asset_ids", []):
            content.append(
                {
                    "type": "audio",
                    "audio_url": await self._asset_data_uri(task.task_id, str(asset_id), "audio")
                    if task.provider_kind in {"volcengine_video", "autodl_video"}
                    else await self._temporary_asset_url(task.task_id, str(asset_id), "audio"),
                }
            )
        for asset_id in task.payload.get("video_asset_ids", []):
            content.append(
                {
                    "type": "video",
                    "video_url": await self._asset_data_uri(task.task_id, str(asset_id), "video")
                    if task.provider_kind == "autodl_video"
                    else await self._temporary_asset_url(task.task_id, str(asset_id), "video"),
                }
            )
        return await submit_generation_task(
            provider_kind=task.provider_kind,
            base_url=task.base_url,
            api_key=task.api_key,
            model_slug=task.model_slug,
            payload=task.payload,
            video_content=content,
        )

    async def _poll_context(self, task: GenerationTaskContext):
        if task.provider_kind == "zealman_video":
            async with self.session_factory() as session:
                row = await self._load_task(session, task.task_id)
                if row is None or utc_now() - row.created_at > timedelta(hours=1):
                    raise ValueError("ZEALMAN 等待超过 60 分钟；请检查上游任务，系统不会自动重提")
            return await get_task(
                base_url=task.base_url,
                api_key=task.api_key,
                task_id=task.provider_task_id,
                monitor=self.zealman_monitor,
            )
        return await poll_generation_task(
            provider_kind=task.provider_kind,
            base_url=task.base_url,
            api_key=task.api_key,
            provider_task_id=task.provider_task_id,
        )

    async def _asset_data_uri(self, task_id: str, asset_id: str, expected_kind: str) -> str:
        path, mime_type = await self._asset_path(task_id, asset_id, expected_kind)
        return await read_data_uri(path=path, mime_type=mime_type)

    async def _asset_path(
        self, task_id: str, asset_id: str, expected_kind: str
    ) -> tuple[Path, str]:
        async with self.session_factory() as session:
            task = await self._load_task(session, task_id)
            if task is None:
                raise ValueError("生成任务已不存在")
            private = await session.get(ModelTestGenerationAsset, asset_id)
            if private is not None:
                if private.task_id != task_id or private.media_kind != expected_kind:
                    raise ValueError("参考素材已不存在或类型不匹配")
                return (
                    self.settings.account_model_test_path(private.owner_user_id, "references")
                    / private.storage_key,
                    private.mime_type,
                )
            has_private = await session.scalar(
                select(ModelTestGenerationAsset.id)
                .where(ModelTestGenerationAsset.task_id == task_id)
                .limit(1)
            )
            if has_private:
                raise ValueError("参考素材已不存在或类型不匹配")
            if self.legacy_references is None:
                raise ValueError("历史参考素材尚未转移到模型服务")
            return await self.legacy_references.path(session, task, asset_id, expected_kind)

    async def _temporary_asset_url(self, task_id: str, asset_id: str, expected_kind: str) -> str:
        try:
            path, mime_type = await self._asset_path(task_id, asset_id, expected_kind)
        except ValueError as exc:
            raise TemporaryMediaError(str(exc)) from None
        return await upload_temporary_reference(
            path=path,
            mime_type=mime_type,
            upload_url=self.settings.fpl_temp_media_upload_url,
            transport=self.temporary_media_transport,
        )

    async def _fail(self, task_id: str, message: str, *, result_url: str = "") -> None:
        await self.task_store.fail(task_id, message, result_url=result_url)

    def _add_log(self, session: AsyncSession, row: ModelTestGenerationTask) -> None:
        if row.log_id:
            return
        latency_ms = max(0, round((utc_now() - row.created_at).total_seconds() * 1000))
        log_id = str(uuid4())
        log = LlmCallLog(
            id=log_id,
            owner_user_id=row.owner_user_id,
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
            **snapshot_from_row(row).as_kwargs(),
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
        async with self.session_factory() as session:
            task = await self._load_task(session, task_id)
            if task is None:
                return
            owner_user_id = task.owner_user_id
        root = self.settings.account_model_test_path(owner_user_id, "generated")
        temp_dir = root / ".tmp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        storage_key = uuid4().hex
        temp_path = temp_dir / storage_key
        final_path = root / storage_key
        committing = False
        try:
            size, media_kind, mime_type, extension = await self._download(result_url, temp_path)
            os.replace(temp_path, final_path)
            async with self.session_factory() as session:
                task = await self._load_task(session, task_id)
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
                if self.terminal_settlement:
                    await self.terminal_settlement(session)
                committing = True
                await session.commit()
        except asyncio.CancelledError:
            temp_path.unlink(missing_ok=True)
            if not committing:
                final_path.unlink(missing_ok=True)
            raise
        except Exception as exc:
            temp_path.unlink(missing_ok=True)
            if not committing:
                final_path.unlink(missing_ok=True)
            # An uncertain commit may already reference final_path; owned recovery
            # must establish the outcome before deleting those bytes.
            await self._fail(task_id, _safe_error(exc), result_url=result_url)
