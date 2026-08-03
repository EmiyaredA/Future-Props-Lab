from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
import time
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from uuid import uuid4

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.credentials import decrypt_secret
from app.core.db import SessionLocal
from app.core.time import utc_now
from app.llm.generation_runtime import generation_semaphore
from app.llm.playground.generation import ACTIVE_GENERATION_STATUSES
from app.llm.providers import create_image_task, create_video_task, get_image_task, get_video_task
from app.llm.providers._senseaudio import SenseAudioProviderError, sanitize_provider_message
from app.models import LlmCallLog, ModelProvider, ModelTestGenerationTask

POLL_INTERVAL_SECONDS = 5
MAX_REDIRECTS = 4


class ModelTestMaterializationError(Exception):
    pass


def _safe_error(exc: Exception) -> str:
    if isinstance(exc, (ModelTestMaterializationError, SenseAudioProviderError, ValueError)):
        return sanitize_provider_message(str(exc))
    if isinstance(exc, httpx.TimeoutException):
        return "SenseAudio 请求超时"
    return f"任务处理失败（{type(exc).__name__}）"


def _generated_type(head: bytes, content_type: str) -> tuple[str, str, str] | None:
    content_type = content_type.split(";", 1)[0].strip().lower()
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        detected = ("image", "image/png", ".png")
    elif head.startswith(b"\xff\xd8\xff"):
        detected = ("image", "image/jpeg", ".jpg")
    elif head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        detected = ("image", "image/webp", ".webp")
    elif head.startswith((b"GIF87a", b"GIF89a")):
        detected = ("image", "image/gif", ".gif")
    elif b"ftyp" in head[4:16]:
        mime = "video/quicktime" if content_type == "video/quicktime" else "video/mp4"
        detected = ("video", mime, ".mov" if mime == "video/quicktime" else ".mp4")
    elif head.startswith(b"\x1aE\xdf\xa3"):
        detected = ("video", "video/webm", ".webm")
    else:
        return None
    return detected if content_type == detected[1] else None


async def _assert_public_https(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ModelTestMaterializationError("生成结果必须使用无凭证的 HTTPS 公网地址")

    def resolve() -> list[str]:
        return list(
            {
                item[4][0]
                for item in socket.getaddrinfo(
                    parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM
                )
            }
        )

    try:
        addresses = await asyncio.to_thread(resolve)
    except OSError as exc:
        raise ModelTestMaterializationError("无法解析生成结果地址") from exc
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ModelTestMaterializationError("生成结果地址指向非公网网络")


class ModelTestGenerationRunner:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] = SessionLocal,
        settings: Settings | None = None,
        download_transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.settings = settings or get_settings()
        self.download_transport = download_transport
        self._stop = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

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

    async def start(self) -> None:
        await self.recover()
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="model-test-generation-runner")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def _run(self) -> None:
        while not self._stop.is_set():
            await self.process_once()
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=POLL_INTERVAL_SECONDS)
            except TimeoutError:
                pass

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

        async def guarded(task_id: str) -> None:
            async with generation_semaphore:
                await self._process_task(task_id)

        await asyncio.gather(*(guarded(task_id) for task_id in task_ids))

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
                    provider_task_id = await create_video_task(
                        base_url=base_url,
                        api_key=api_key,
                        model=model_slug,
                        content=[{"type": "text", "text": str(payload["prompt"])}],
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
        current_url = url
        content_type = ""
        size = 0
        head = bytearray()
        timeout = httpx.Timeout(120.0, connect=15.0)
        async with httpx.AsyncClient(
            timeout=timeout, follow_redirects=False, transport=self.download_transport
        ) as client:
            for _ in range(MAX_REDIRECTS + 1):
                await _assert_public_https(current_url)
                async with client.stream("GET", current_url) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise ModelTestMaterializationError("生成结果重定向缺少地址")
                        current_url = urljoin(current_url, location)
                        continue
                    if response.is_error:
                        raise ModelTestMaterializationError(
                            f"生成结果下载失败（HTTP {response.status_code}）"
                        )
                    declared_size = response.headers.get("content-length")
                    if (
                        declared_size
                        and declared_size.isdecimal()
                        and int(declared_size) > self.settings.fpl_visual_asset_max_bytes
                    ):
                        raise ModelTestMaterializationError("生成结果超过文件大小上限")
                    content_type = response.headers.get("content-type", "")
                    with target.open("xb") as output:
                        async for chunk in response.aiter_bytes(1024 * 1024):
                            size += len(chunk)
                            if size > self.settings.fpl_visual_asset_max_bytes:
                                raise ModelTestMaterializationError("生成结果超过文件大小上限")
                            if len(head) < 512:
                                head.extend(chunk[: 512 - len(head)])
                            output.write(chunk)
                    break
            else:
                raise ModelTestMaterializationError("生成结果重定向次数过多")
        detected = _generated_type(bytes(head), content_type)
        if size == 0 or detected is None:
            raise ModelTestMaterializationError("生成结果不是受支持的图片或视频")
        return size, *detected

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
