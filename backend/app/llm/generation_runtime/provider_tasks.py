from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from app.llm.generation_runtime.driver import ImmediateGenerationResult
from app.llm.generation_runtime.media import GenerationMaterializationError
from app.llm.providers import (
    autodl_video,
    volcengine_video,
)
from app.llm.providers._senseaudio import (
    ProviderTaskStatus,
    SenseAudioProviderError,
    sanitize_provider_message,
)
from app.llm.providers.senseaudio_audio import (
    create_music_task,
    create_sound_effect,
    get_music_task,
)
from app.llm.providers.senseaudio_image import create_image_task, get_image_task
from app.llm.providers.senseaudio_video import create_video_task, get_video_task
from app.llm.providers.temporary_media import TemporaryMediaError, upload_temporary_media
from app.llm.providers.volcengine_image import generate_image
from app.runtime.outbound_urls import require_safe_provider_base_url

MAX_PROVIDER_CONTENT_BYTES = 64 * 1024 * 1024


def safe_generation_error(exc: Exception) -> str:
    """Convert provider/runtime errors to stable, non-sensitive user messages."""
    if isinstance(exc, TemporaryMediaError):
        return "参考素材临时上传失败，请重新生成"
    if isinstance(exc, (GenerationMaterializationError, SenseAudioProviderError, ValueError)):
        return sanitize_provider_message(str(exc))
    if isinstance(exc, httpx.TimeoutException):
        return "供应商请求超时"
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
    image_references: list[str] | None = None,
    video_content: list[dict[str, object]] | None = None,
    audio_reference_urls: list[str] | None = None,
) -> str | ImmediateGenerationResult:
    """Submit a normalized image, video, music, or sound-effect task."""
    base_url = require_safe_provider_base_url(base_url)
    if provider_kind == "autodl_video":
        return await autodl_video.create_task(
            base_url=base_url,
            api_key=api_key,
            model=model_slug,
            payload=payload,
            content=video_content or [],
        )
    if provider_kind == "volcengine_image":
        return ImmediateGenerationResult(
            await generate_image(
                base_url=base_url,
                api_key=api_key,
                model=model_slug,
                payload=payload,
                references=image_references or ([image_reference] if image_reference else []),
            )
        )
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

    if provider_kind == "volcengine_video":
        return await volcengine_video.create_task(
            base_url=base_url,
            api_key=api_key,
            model=model_slug,
            payload=payload,
            content=video_content or [],
        )

    content = video_content or []
    validate_provider_content(content)
    return await create_video_task(
        base_url=base_url,
        api_key=api_key,
        model=model_slug,
        content=content,
        duration=int(payload["duration"]),
        resolution=str(payload.get("resolution") or "720p"),
        ratio=str(payload.get("ratio") or "16:9"),
        watermark=payload.get("watermark") is not False,
        generate_audio=bool(payload.get("generate_audio")),
    )


async def poll_generation_task(
    *, provider_kind: str, base_url: str, api_key: str, provider_task_id: str
):
    base_url = require_safe_provider_base_url(base_url)
    if provider_kind == "autodl_video":
        return await autodl_video.get_task(
            base_url=base_url, api_key=api_key, task_id=provider_task_id
        )
    if provider_kind == "volcengine_video":
        return await volcengine_video.get_task(
            base_url=base_url, api_key=api_key, task_id=provider_task_id
        )
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
