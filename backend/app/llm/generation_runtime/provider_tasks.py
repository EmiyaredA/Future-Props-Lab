from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from app.llm.generation_runtime.media import GenerationMaterializationError
from app.llm.providers import (
    create_image_task,
    create_music_task,
    create_sound_effect,
    create_video_task,
    get_image_task,
    get_music_task,
    get_video_task,
)
from app.llm.providers._senseaudio import (
    ProviderTaskStatus,
    SenseAudioProviderError,
    sanitize_provider_message,
)
from app.llm.providers.temporary_media import TemporaryMediaError, upload_temporary_media
from app.runtime.outbound_urls import require_safe_provider_base_url

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
    audio_reference_urls: list[str] | None = None,
) -> str:
    """Submit a normalized image, video, music, or sound-effect task."""
    base_url = require_safe_provider_base_url(base_url)
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
    if provider_kind == "senseaudio_music":
        return await create_music_task(
            base_url=base_url,
            api_key=api_key,
            model=model_slug,
            prompt=str(payload["prompt"]),
            theme=str(payload.get("theme") or ""),
            style=str(payload.get("style") or ""),
            duration=payload.get("duration"),
            output_format=str(payload.get("output_format") or "mp3"),
            reference_urls=audio_reference_urls or [],
        )
    if provider_kind == "senseaudio_sfx":
        return await create_sound_effect(
            base_url=base_url,
            api_key=api_key,
            model=model_slug,
            text=str(payload["prompt"]),
            duration=payload.get("duration"),
            smart_duration=bool(payload.get("smart_duration", True)),
            prompt_influence=float(payload.get("prompt_influence", 0.5)),
            output_format=str(payload.get("output_format") or "mp3"),
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
    base_url = require_safe_provider_base_url(base_url)
    if provider_kind == "senseaudio_image":
        return await get_image_task(
            base_url=base_url,
            api_key=api_key,
            task_id=provider_task_id,
        )
    if provider_kind == "senseaudio_music":
        return await get_music_task(
            base_url=base_url,
            api_key=api_key,
            task_id=provider_task_id,
        )
    if provider_kind == "senseaudio_sfx":
        return ProviderTaskStatus(status="completed", progress=100, result_url=provider_task_id)
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
    filename: str | None = None,
    file_extension: str = "",
) -> str:
    return await upload_temporary_media(
        path=path,
        mime_type=mime_type,
        upload_url=upload_url,
        transport=transport,
        filename=filename,
        file_extension=file_extension,
    )
