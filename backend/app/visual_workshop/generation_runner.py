from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.credentials import decrypt_secret
from app.core.db import SessionLocal
from app.core.tenant_context import bind_workspace, current_workspace_id
from app.core.time import utc_now
from app.files.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.llm.generation_runtime import (
    GenerationMaterializationError,
    PollingGenerationRunner,
    assert_public_https,
    download_generated_media,
    generated_type,
    poll_generation_task,
    read_data_uri,
    safe_generation_error,
    submit_generation_task,
    upload_temporary_reference,
)
from app.llm.providers.temporary_media import TemporaryMediaError
from app.models import ModelProvider, VisualAsset, VisualGenerationTask
from app.visual_workshop.generation import ACTIVE_TASK_STATUSES

MaterializationError = GenerationMaterializationError
_assert_public_https = assert_public_https
_generated_type = generated_type


def _safe_task_error(exc: Exception) -> str:
    return safe_generation_error(exc)


class VisualGenerationRunner(PollingGenerationRunner):
    runner_name = "visual-generation-runner"

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
        self.storage = AssetStorage(self.settings)
        self.download_transport = download_transport
        self.temporary_media_transport = temporary_media_transport

    async def _load_task(self, session: AsyncSession, task_id: str) -> VisualGenerationTask | None:
        task = await session.get(VisualGenerationTask, task_id)
        if task is not None:
            bind_workspace(session, task.workspace_id)
        return task

    async def recover(self) -> None:
        async with self.session_factory() as session:
            await session.execute(
                update(VisualGenerationTask)
                .where(VisualGenerationTask.status == "submitting")
                .values(
                    status="failed",
                    error_message="应用在提交供应商任务期间中断；为避免重复计费，请重新生成",
                    revision=VisualGenerationTask.revision + 1,
                    updated_at=utc_now(),
                )
            )
            await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            task_ids = list(
                (
                    await session.execute(
                        select(VisualGenerationTask.id)
                        .where(VisualGenerationTask.status.in_(ACTIVE_TASK_STATUSES))
                        .order_by(VisualGenerationTask.updated_at)
                        .limit(40)
                    )
                )
                .scalars()
                .all()
            )

        await self.run_concurrently(task_ids, self._process_task)

    async def _fail(self, task_id: str, message: str, *, result_url: str = "") -> None:
        async with self.session_factory() as session:
            row = await self._load_task(session, task_id)
            if row is None or row.status == "completed":
                return
            row.status = "failed"
            row.error_message = message[:4000]
            if result_url:
                row.result_url = result_url
            row.revision += 1
            row.updated_at = utc_now()
            await session.commit()

    async def _process_task(self, task_id: str) -> None:
        try:
            async with self.session_factory() as session:
                task = await self._load_task(session, task_id)
                if task is None or task.status not in ACTIVE_TASK_STATUSES:
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
                provider_task_id = await self._submit(
                    provider_kind=provider_kind,
                    base_url=base_url,
                    api_key=api_key,
                    model_slug=model_slug,
                    payload=payload,
                )
                async with self.session_factory() as session:
                    current = await self._load_task(session, task_id)
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

            provider_status = await poll_generation_task(
                provider_kind=provider_kind,
                base_url=base_url,
                api_key=api_key,
                provider_task_id=provider_task_id,
            )
            if provider_status.status == "failed":
                await self._fail(
                    task_id,
                    safe_generation_error(ValueError(provider_status.error_message))
                    if provider_status.error_message
                    else "SenseAudio 生成任务失败",
                )
                return
            if provider_status.status == "completed":
                if not provider_status.result_url:
                    await self._fail(task_id, "SenseAudio 已完成任务但未返回结果地址")
                    return
                async with self.session_factory() as session:
                    current = await self._load_task(session, task_id)
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
                current = await self._load_task(session, task_id)
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
            await self._fail(task_id, _safe_task_error(exc))

    async def _asset_data_uri(self, asset_id: str) -> str:
        async with self.session_factory() as session:
            bind_workspace(session, current_workspace_id())
            asset = await session.get(VisualAsset, asset_id)
            if asset is None or asset.media_kind != "image":
                raise ValueError("参考图片已不存在")
            path = self.storage.path_for(asset)
            mime_type = asset.mime_type
            byte_size = asset.byte_size
        if byte_size > 30 * 1024 * 1024:
            raise ValueError("参考图片超过 SenseAudio 的 30 MB 限制")
        return await read_data_uri(path=path, mime_type=mime_type, max_bytes=30 * 1024 * 1024)

    async def _temporary_asset_url(self, asset_id: str, expected_kind: str) -> str:
        async with self.session_factory() as session:
            bind_workspace(session, current_workspace_id())
            asset = await session.get(VisualAsset, asset_id)
            if asset is None or asset.media_kind != expected_kind:
                raise TemporaryMediaError("参考素材已不存在或类型不匹配")
            path = self.storage.path_for(asset)
            mime_type = asset.mime_type
        return await upload_temporary_reference(
            path=path,
            mime_type=mime_type,
            upload_url=self.settings.fpl_temp_media_upload_url,
            transport=self.temporary_media_transport,
        )

    async def _submit(
        self,
        *,
        provider_kind: str,
        base_url: str,
        api_key: str,
        model_slug: str,
        payload: dict,
    ) -> str:
        if provider_kind == "senseaudio_image":
            reference_id = payload.get("reference_asset_id")
            reference = await self._asset_data_uri(str(reference_id)) if reference_id else None
            return await submit_generation_task(
                provider_kind=provider_kind,
                base_url=base_url,
                api_key=api_key,
                model_slug=model_slug,
                payload=payload,
                image_reference=reference,
            )

        content: list[dict[str, object]] = []
        if payload.get("prompt"):
            content.append({"type": "text", "text": payload["prompt"]})
        mode = payload.get("mode")
        if mode == "frames":
            content.append(
                {
                    "type": "image",
                    "url": await self._asset_data_uri(payload["first_frame_asset_id"]),
                    "role": "first_frame",
                }
            )
            if payload.get("last_frame_asset_id"):
                content.append(
                    {
                        "type": "image",
                        "url": await self._asset_data_uri(payload["last_frame_asset_id"]),
                        "role": "last_frame",
                    }
                )
        elif mode == "reference":
            for asset_id in payload.get("reference_asset_ids", []):
                content.append(
                    {
                        "type": "image",
                        "url": await self._asset_data_uri(asset_id),
                        "role": "reference",
                    }
                )
            for asset_id in payload.get("audio_asset_ids", []):
                content.append(
                    {
                        "type": "audio",
                        "audio_url": await self._temporary_asset_url(str(asset_id), "audio"),
                    }
                )
            for asset_id in payload.get("video_asset_ids", []):
                content.append(
                    {
                        "type": "video",
                        "video_url": await self._temporary_asset_url(str(asset_id), "video"),
                    }
                )
            # Compatibility for tasks queued before asset-ID based references were introduced.
            content.extend(
                {"type": "audio", "audio_url": url} for url in payload.get("audio_urls", [])
            )
            content.extend(
                {"type": "video", "video_url": url} for url in payload.get("video_urls", [])
            )
        return await submit_generation_task(
            provider_kind=provider_kind,
            base_url=base_url,
            api_key=api_key,
            model_slug=model_slug,
            payload=payload,
            video_content=content,
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
            if task is None:
                return
            project_id = task.project_id
            workspace_id = task.workspace_id
        temp_path, final_path = self.storage.prepare_write(
            storage_key,
            visual_project_id=project_id,
            galgame_project_id=None,
            workspace_id=workspace_id,
        )
        try:
            size, media_kind, mime_type, extension = await self._download(result_url, temp_path)
            os.replace(temp_path, final_path)
            async with self.session_factory() as session:
                task = await self._load_task(session, task_id)
                if task is None:
                    final_path.unlink(missing_ok=True)
                    return
                if media_kind != task.generation_kind:
                    raise MaterializationError("生成结果类型与任务类型不一致")
                filename = f"{task.model_slug}-{task.id[:8]}{extension}"
                asset = VisualAsset(
                    workspace_id=task.workspace_id,
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
