from __future__ import annotations

from typing import Any

import httpx

from app.llm.providers._senseaudio import ProviderTaskStatus, headers, response_json, root_url


async def create_video_task(
    *,
    base_url: str,
    api_key: str,
    model: str,
    content: list[dict[str, Any]],
    duration: int,
    resolution: str,
    ratio: str,
    watermark: bool,
    generate_audio: bool,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0), transport=transport) as client:
        payload = response_json(
            await client.post(
                f"{root_url(base_url)}/video/create",
                headers=headers(api_key),
                json={
                    "model": model,
                    "content": content,
                    "duration": duration,
                    "resolution": resolution,
                    "ratio": ratio,
                    "watermark": watermark,
                    "provider_specific": {"generate_audio": generate_audio},
                },
            )
        )
    task_id = str(payload.get("task_id") or "")
    if not task_id:
        raise ValueError("SenseAudio 视频任务未返回 task_id")
    return task_id


async def get_video_task(
    *,
    base_url: str,
    api_key: str,
    task_id: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ProviderTaskStatus:
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), transport=transport) as client:
        payload = response_json(
            await client.get(
                f"{root_url(base_url)}/video/status",
                headers=headers(api_key),
                params={"id": task_id},
            )
        )
    return ProviderTaskStatus(
        status=str(payload.get("status") or "pending"),
        progress=max(0, min(100, int(payload.get("progress") or 0))),
        result_url=str(payload.get("video_url") or ""),
        error_message=str(payload.get("error_message") or ""),
    )
