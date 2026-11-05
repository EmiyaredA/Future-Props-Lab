from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.capabilities.media_rendering.image_grid import render_image_grid
from studio.apps.asset_library.storage.file_paths import TARGET_STORAGE_VERSION, AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.model_service.generation.driver import (
    ClaimAdmission,
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
    upload_temporary_reference,
)
from studio.apps.model_service.generation.visual_submission import (
    VisualGenerationInputs,
    submit_visual_generation,
)
from studio.apps.model_service.providers.temporary_media import TemporaryMediaError
from studio.apps.model_service.providers.zealman_live import ZealmanLiveMonitor
from studio.apps.model_service.providers.zealman_video import get_task
from studio.apps.visual_workshop.generation_records import ACTIVE_TASK_STATUSES
from studio.apps.visual_workshop.outputs.history import publish_generated_output
from studio.apps.visual_workshop.storage.models import VisualGenerationBatch, VisualGenerationTask
from studio.config.settings import Settings
from studio.runtime.database.ownership import bind_owner
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now

MaterializationError = GenerationMaterializationError
_assert_public_https = assert_public_https
_generated_type = generated_type


def _safe_task_error(exc: Exception) -> str:
    return safe_generation_error(exc)


class VisualGenerationRunner(PollingTaskRunner):
    runner_name = "visual-generation-runner"

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        download_transport: httpx.AsyncBaseTransport | None = None,
        temporary_media_transport: httpx.AsyncBaseTransport | None = None,
        claim_admission: ClaimAdmission | None = None,
        queue_candidates: Callable[..., Awaitable[list[str]]] | None = None,
    ) -> None:
        super().__init__()
        self.queue_candidates = queue_candidates
        self.zealman_monitor = ZealmanLiveMonitor()
        self.session_factory = session_factory
        self.settings = settings
        self.storage = AssetStorage(self.settings)
        self.download_transport = download_transport
        self.temporary_media_transport = temporary_media_transport
        self._composing_batches: set[str] = set()
        self.task_store = GenerationTaskStore(
            session_factory=self.session_factory,
            task_type=VisualGenerationTask,
            active_statuses=ACTIVE_TASK_STATUSES,
            task_subject="visual generation task",
            claim_admission=claim_admission,
        )
        self.task_driver = GenerationTaskDriver(
            store=self.task_store,
            submit=self._submit_context,
            poll=self._poll_context,
            materialize=self._materialize,
            map_error=_safe_task_error,
            provider_failure_message="SenseAudio 生成任务失败",
            missing_result_message="SenseAudio 已完成任务但未返回结果地址",
        )

    async def _load_task(self, session: AsyncSession, task_id: str) -> VisualGenerationTask | None:
        return await self.task_store.load(session, task_id)

    async def stop(self) -> None:
        await super().stop()
        await self.zealman_monitor.close()

    async def recover(self) -> None:
        await self.task_driver.recover()
        await self._refresh_batches()

    async def process_once(self) -> None:
        if self.queue_candidates is None:
            task_ids = await self.task_store.active_task_ids()
            await self.run_concurrently(task_ids, self._process_task)
        else:
            task_ids = await self.task_store.active_task_ids(
                statuses=("submitting", "pending", "processing")
            )
            await self.run_concurrently(task_ids, self._process_task)
            queued = await self.queue_candidates(self.session_factory)
            await self.run_concurrently(queued, self._process_task)
        await self._refresh_batches()

    async def _fail(self, task_id: str, message: str, *, result_url: str = "") -> None:
        await self.task_store.fail(task_id, message, result_url=result_url)

    async def _process_task(self, task_id: str) -> None:
        await self.task_driver.process(task_id)

    async def _refresh_batches(self) -> None:
        async with self.session_factory() as session:
            batch_ids = list(
                await session.scalars(
                    select(VisualGenerationBatch.id).where(
                        VisualGenerationBatch.status.in_(("queued", "processing"))
                    )
                )
            )
        for batch_id in batch_ids:
            await self._refresh_batch(batch_id)

    async def _refresh_batch(self, batch_id: str) -> None:
        async with self.session_factory() as session:
            batch = await session.get(VisualGenerationBatch, batch_id)
            if batch is None or batch.status in {"completed", "cancelled"}:
                return
            if batch.batch_kind == "composition":
                batch.status = "processing"
                batch.completed_count = 0
                batch.failed_count = 0
                batch.updated_at = utc_now()
                batch.revision += 1
                await session.commit()
            else:
                tasks = list(
                    await session.scalars(
                        select(VisualGenerationTask).where(
                            VisualGenerationTask.id.in_(list(batch.child_task_ids or []))
                        )
                    )
                )
                completed = sum(task.status == "completed" for task in tasks)
                failed = sum(task.status == "failed" for task in tasks)
                cancelled = sum(task.status == "cancelled" for task in tasks)
                batch.completed_count = completed
                batch.failed_count = failed
                batch.cancelled_count = cancelled
                batch.updated_at = utc_now()
                batch.revision += 1
                if completed + failed + cancelled != batch.grid_size:
                    batch.status = (
                        "queued" if all(t.status == "queued" for t in tasks) else "processing"
                    )
                    await session.commit()
                    return
                if failed or cancelled:
                    batch.status = "cancelled" if cancelled else "failed"
                    batch.error_message = f"{failed} 个子任务失败，{cancelled} 个子任务取消"
                    batch.completed_at = batch.updated_at
                    await session.commit()
                    return
                if batch.grid_output == "nodes":
                    batch.status = "completed"
                    batch.completed_at = batch.updated_at
                    await session.commit()
                    return
                await session.commit()
        if batch_id in self._composing_batches:
            return
        self._composing_batches.add(batch_id)
        try:
            await self._compose_batch(batch_id)
        finally:
            self._composing_batches.discard(batch_id)

    async def _compose_batch(self, batch_id: str) -> None:
        async with self.session_factory() as session:
            batch = await session.get(VisualGenerationBatch, batch_id)
            if batch is None or batch.result_asset_id or batch.status == "completed":
                return
            if batch.batch_kind == "composition":
                source_items = list(batch.source_items or [])
                asset_ids = [str(item.get("asset_id") or "") for item in source_items]
                captions = [str(item.get("caption") or "") for item in source_items]
                input_snapshot = source_items
            else:
                tasks = list(
                    await session.scalars(
                        select(VisualGenerationTask).where(
                            VisualGenerationTask.id.in_(list(batch.child_task_ids or []))
                        )
                    )
                )
                by_id = {task.id: task for task in tasks}
                ordered = [by_id.get(task_id) for task_id in batch.child_task_ids]
                if any(task is None or not task.result_asset_id for task in ordered):
                    return
                asset_ids = [str(task.result_asset_id) for task in ordered if task is not None]
                captions = [""] * len(asset_ids)
                input_snapshot = ordered[0].request_payload.get("input_snapshot", [])
            assets = [await session.get(VisualAsset, asset_id) for asset_id in asset_ids]
            if any(asset is None for asset in assets):
                return
            paths = [self.storage.path_for(asset) for asset in assets if asset is not None]
            owner_user_id = batch.owner_user_id
            project_id = batch.project_id
            grid_size = batch.grid_size
            generation_node_id = batch.generation_node_id

        storage_key = f"grid-{batch_id}"
        async with self.session_factory() as session:
            existing = await session.scalar(
                select(VisualAsset).where(
                    VisualAsset.storage_key == storage_key,
                    VisualAsset.project_id == project_id,
                    VisualAsset.owner_user_id == owner_user_id,
                )
            )
            if existing is not None:
                batch = await session.get(VisualGenerationBatch, batch_id)
                if batch is None or batch.result_asset_id:
                    return
                await publish_generated_output(
                    session,
                    project_id,
                    generation_node_id,
                    existing.id,
                    f"batch:{batch_id}",
                    input_snapshot=input_snapshot,
                )
                batch.result_asset_id = existing.id
                batch.status = "completed"
                batch.completed_count = batch.grid_size
                batch.failed_count = 0
                batch.error_message = None
                batch.completed_at = utc_now()
                batch.updated_at = batch.completed_at
                batch.revision += 1
                await session.commit()
                return
        temp_path, final_path = self.storage.prepare_write(
            storage_key,
            visual_project_id=project_id,
            galgame_project_id=None,
            owner_user_id=owner_user_id,
        )
        try:
            render_image_grid(paths, captions, temp_path, grid_size)
            byte_size = temp_path.stat().st_size
            os.replace(temp_path, final_path)
            async with self.session_factory() as session:
                batch = await session.get(VisualGenerationBatch, batch_id)
                if batch is None or batch.result_asset_id:
                    final_path.unlink(missing_ok=True)
                    return
                side = 2 if batch.grid_size == 4 else 3
                filename = f"grid-{side}x{side}-{batch.id[:8]}.png"
                asset = await session.scalar(
                    select(VisualAsset).where(VisualAsset.storage_key == storage_key)
                )
                if asset is None:
                    asset = VisualAsset(
                        owner_user_id=batch.owner_user_id,
                        project_id=batch.project_id,
                        folder_id=None,
                        original_filename=filename,
                        display_name=filename,
                        storage_key=storage_key,
                        storage_version=TARGET_STORAGE_VERSION,
                        media_kind="image",
                        mime_type="image/png",
                        byte_size=byte_size,
                    )
                    session.add(asset)
                    await session.flush()
                await publish_generated_output(
                    session,
                    project_id,
                    generation_node_id,
                    asset.id,
                    f"batch:{batch_id}",
                    input_snapshot=input_snapshot,
                )
                batch.result_asset_id = asset.id
                batch.status = "completed"
                batch.completed_count = batch.grid_size
                batch.failed_count = 0
                batch.error_message = None
                batch.completed_at = utc_now()
                batch.updated_at = batch.completed_at
                batch.revision += 1
                await session.commit()
        except Exception as exc:
            temp_path.unlink(missing_ok=True)
            final_path.unlink(missing_ok=True)
            async with self.session_factory() as session:
                batch = await session.get(VisualGenerationBatch, batch_id)
                if batch is not None and batch.status != "completed":
                    batch.status = "failed"
                    batch.error_message = f"宫格合成失败：{safe_generation_error(exc)}"
                    batch.completed_at = utc_now()
                    batch.updated_at = batch.completed_at
                    batch.revision += 1
                    await session.commit()

    async def _submit_context(self, task: GenerationTaskContext) -> str | ImmediateGenerationResult:
        return await self._submit(
            provider_kind=task.provider_kind,
            base_url=task.base_url,
            api_key=task.api_key,
            model_slug=task.model_slug,
            payload=task.payload,
            owner_user_id=task.owner_user_id,
        )

    async def _poll_context(self, task: GenerationTaskContext):
        if task.provider_kind == "zealman_video":
            async with self.session_factory() as session:
                row = await self._load_task(session, task.task_id)
                if row is None or utc_now() - (row.submitted_at or row.created_at) > timedelta(
                    hours=1
                ):
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

    async def _asset_data_uri(
        self, asset_id: str, owner_user_id: str, *, expected_kind: str | None = None
    ) -> str:
        async with self.session_factory() as session:
            bind_owner(session, owner_user_id)
            asset = await session.get(VisualAsset, asset_id)
            allowed = {expected_kind} if expected_kind else {"image", "audio"}
            if asset is None or asset.media_kind not in allowed:
                raise ValueError("参考图片已不存在")
            path = self.storage.path_for(asset)
            mime_type = asset.mime_type
            byte_size = asset.byte_size
        limit = (45 if expected_kind == "video" else 30) * 1024 * 1024
        if byte_size > limit:
            raise ValueError("参考素材超过内联大小限制")
        return await read_data_uri(path=path, mime_type=mime_type, max_bytes=limit)

    async def _temporary_asset_url(
        self,
        asset_id: str,
        expected_kind: str,
        owner_user_id: str,
        filename: str | None = None,
    ) -> str:
        async with self.session_factory() as session:
            bind_owner(session, owner_user_id)
            asset = await session.get(VisualAsset, asset_id)
            if asset is None or asset.media_kind != expected_kind:
                raise TemporaryMediaError("参考素材已不存在或类型不匹配")
            path = self.storage.path_for(asset)
            mime_type = asset.mime_type
            extension = Path(asset.original_filename).suffix
        return await upload_temporary_reference(
            path=path,
            mime_type=mime_type,
            upload_url=self.settings.fpl_temp_media_upload_url,
            transport=self.temporary_media_transport,
            filename=filename,
            file_extension=extension,
        )

    async def _local_reference(self, asset_id, kind, owner_user_id):
        async with self.session_factory() as session:
            bind_owner(session, owner_user_id)
            asset = await session.get(VisualAsset, asset_id)
            if asset is None or asset.media_kind != kind:
                raise ValueError("参考素材已不存在或类型不匹配")
            return self.storage.path_for(asset), asset.mime_type

    async def _submit(
        self,
        *,
        provider_kind: str,
        base_url: str,
        api_key: str,
        model_slug: str,
        payload: dict,
        owner_user_id: str,
    ) -> str | ImmediateGenerationResult:
        return await submit_visual_generation(
            VisualGenerationInputs(
                self._local_reference, self._asset_data_uri, self._temporary_asset_url
            ),
            provider_kind=provider_kind,
            base_url=base_url,
            api_key=api_key,
            model_slug=model_slug,
            payload=payload,
            owner_user_id=owner_user_id,
        )

    async def _download(self, url: str, target: Path) -> tuple[int, str, str, str]:
        return await download_generated_media(
            url=url,
            target=target,
            max_bytes=self.settings.fpl_visual_asset_max_bytes,
            transport=self.download_transport,
        )

    async def _materialize(self, task_id: str, result_url: str) -> None:
        storage_key = uuid4().hex
        async with self.session_factory() as session:
            task = await self._load_task(session, task_id)
            if task is None or task.result_asset_id:
                return
            project_id = task.project_id
            owner_user_id = task.owner_user_id
        temp_path, final_path = self.storage.prepare_write(
            storage_key,
            visual_project_id=project_id,
            galgame_project_id=None,
            owner_user_id=owner_user_id,
        )
        try:
            size, media_kind, mime_type, extension = await self._download(result_url, temp_path)
            os.replace(temp_path, final_path)
            async with self.session_factory() as session:
                await session.execute(
                    update(VisualGenerationTask)
                    .where(VisualGenerationTask.id == task_id)
                    .values(revision=VisualGenerationTask.revision)
                )
                task = await self._load_task(session, task_id)
                if task is None or task.result_asset_id:
                    final_path.unlink(missing_ok=True)
                    return
                if media_kind != task.generation_kind:
                    raise MaterializationError("生成结果类型与任务类型不一致")
                filename = f"{task.model_slug}-{task.id[:8]}{extension}"
                asset = VisualAsset(
                    owner_user_id=task.owner_user_id,
                    project_id=task.project_id,
                    folder_id=None,
                    original_filename=filename,
                    display_name=filename,
                    storage_key=storage_key,
                    storage_version=TARGET_STORAGE_VERSION,
                    media_kind=media_kind,
                    mime_type=mime_type,
                    byte_size=size,
                )
                session.add(asset)
                await session.flush()
                output_node_id = await publish_generated_output(
                    session,
                    project_id,
                    task.canvas_node_id,
                    asset.id,
                    f"task:{task.id}",
                    task.id,
                    task.request_payload.get("input_snapshot", []),
                )
                task.canvas_node_id = output_node_id or task.canvas_node_id
                task.result_asset_id = asset.id
                task.status = "completed"
                task.progress = 100
                task.error_message = None
                task.completed_at = utc_now()
                task.updated_at = task.completed_at
                task.revision += 1
                await session.commit()
        except Exception:
            temp_path.unlink(missing_ok=True)
            final_path.unlink(missing_ok=True)
            raise
