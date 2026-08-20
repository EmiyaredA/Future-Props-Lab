from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from app.llm.generation_runtime.media import GenerationMaterializationError
from app.llm.providers import (
    create_image_task,
    create_video_task,
    get_image_task,
    get_video_task,
)
from app.llm.providers._senseaudio import (
    SenseAudioProviderError,
    sanitize_provider_message,
)
from app.llm.providers.temporary_media import TemporaryMediaError, upload_temporary_media

MAX_PROVIDER_CONTENT_BYTES = 64 * 1024 * 1024


def safe_generation_error(exc: Exception) -> str:
    """Convert provider/runtime errors to stable, non-sensitive user messages."""
    if isinstance(exc, TemporaryMediaError):
        return "参考素材临时上传失败，请重新生成"
    if isinstance(exc, (GenerationMaterializationError, SenseAudioProviderError, ValueError)):
        return sanitize_provider_message(str(exc))
    if isinstance(exc, httpx.TimeoutException):
        return "SenseAudio 请求超时"
    return f"任务处理失败（{type(exc).__name__}）"


def validate_provider_content(content: list[dict[str, object]]) -> None:
    if len(str(content).encode("utf-8")) > MAX_PROVIDER_CONTENT_BYTES:
        raise ValueError("参考素材请求体超过 SenseAudio 的 64 MB 限制")


async def submit_generation_task(
    *,
    provider_kind: str,
    base_url: str,
    api_key: str,
    model_slug: str,
    payload: dict[str, Any],
    image_reference: str | None = None,
    video_content: list[dict[str, object]] | None = None,
) -> str:
    """Submit a normalized image or video task through the provider boundary."""
    if provider_kind == "senseaudio_image":
        return await create_image_task(
            base_url=base_url,
            api_key=api_key,
            model=model_slug,
            prompt=str(payload["prompt"]),
            size=str(payload["size"]),
            seed=payload.get("seed"),
            reference=image_reference,
        )

    content = video_content or []
    validate_provider_content(content)
    return await create_video_task(
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


async def poll_generation_task(
    *, provider_kind: str, base_url: str, api_key: str, provider_task_id: str
):
    if provider_kind == "senseaudio_image":
        return await get_image_task(
            base_url=base_url,
            api_key=api_key,
            task_id=provider_task_id,
        )
    return await get_video_task(
        base_url=base_url,
        api_key=api_key,
        task_id=provider_task_id,
    )


async def upload_temporary_reference(
    *,
    path: Path,
    mime_type: str,
    upload_url: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    return await upload_temporary_media(
        path=path,
        mime_type=mime_type,
        upload_url=upload_url,
        transport=transport,
    )
