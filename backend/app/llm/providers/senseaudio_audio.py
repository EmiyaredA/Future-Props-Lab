from __future__ import annotations

from typing import Any

import httpx

from app.llm.providers._senseaudio import (
    ProviderTaskStatus,
    headers,
    response_json,
    root_url,
)


def _api_origin(base_url: str) -> str:
    return root_url(base_url).removesuffix("/v1")


def _result_url(payload: dict[str, Any]) -> str:
    direct = payload.get("url") or payload.get("audio_url") or payload.get("audioUrl")
    if direct:
        return str(direct)
    for key in ("response", "data", "items", "audios", "results", "output"):
        value = payload.get(key)
        if isinstance(value, dict):
            nested = _result_url(value)
            if nested:
                return nested
        if isinstance(value, list) and value and isinstance(value[0], dict):
            nested = _result_url(value[0])
            if nested:
                return nested
    return ""


async def create_music_task(
    *,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    theme: str,
    style: str,
    duration: int | None,
    output_format: str,
    reference_urls: list[str],
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    audio_settings: dict[str, Any] = {"format": output_format}
    if duration is not None:
        audio_settings["duration"] = duration
    body: dict[str, Any] = {
        "model": model,
        "prompt": "\n".join(value for value in (theme, prompt) if value),
        "mode": "instrumental",
        "audio_settings": audio_settings,
    }
    if style:
        body["style"] = style
    if reference_urls:
        body["attachments"] = [{"type": "audio", "url": url} for url in reference_urls]
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0), transport=transport) as client:
        payload = response_json(
            await client.post(
                f"{_api_origin(base_url)}/v2/music/song/create",
                headers=headers(api_key),
                json=body,
            )
        )
    task_id = str(payload.get("task_id") or payload.get("taskId") or "")
    if not task_id and isinstance(payload.get("data"), dict):
        task_id = str(payload["data"].get("task_id") or "")
    if not task_id:
        raise ValueError("SenseAudio 音乐任务未返回 task_id")
    return task_id


async def get_music_task(
    *,
    base_url: str,
    api_key: str,
    task_id: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ProviderTaskStatus:
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), transport=transport) as client:
        payload = response_json(
            await client.get(
                f"{_api_origin(base_url)}/v1/music/song/pending/{task_id}",
                headers=headers(api_key),
            )
        )
    response = payload.get("response")
    status = str(payload.get("status") or "pending").lower()
    normalized = {
        "success": "completed",
        "succeeded": "completed",
        "done": "completed",
        "error": "failed",
    }.get(status, status)
    return ProviderTaskStatus(
        status=normalized,
        progress=int(payload.get("progress") or (100 if normalized == "completed" else 0)),
        result_url=_result_url(response if isinstance(response, dict) else payload),
        error_message=str(payload.get("error_message") or payload.get("message") or ""),
    )


async def create_sound_effect(
    *,
    base_url: str,
    api_key: str,
    model: str,
    text: str,
    duration: int | None,
    smart_duration: bool,
    prompt_influence: float,
    output_format: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    body: dict[str, Any] = {
        "model": model,
        "text": text,
        "variants_count": 1,
        "prompt_influence": prompt_influence,
        "output_format": output_format,
        "smart_duration": smart_duration,
    }
    if not smart_duration and duration is not None:
        body["duration_seconds"] = duration
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0), transport=transport) as client:
        payload = response_json(
            await client.post(
                f"{_api_origin(base_url)}/v1/sound-effects/generations",
                headers=headers(api_key),
                json=body,
            )
        )
    url = _result_url(payload)
    if not url:
        raise ValueError("SenseAudio 音效生成未返回结果地址")
    return url
