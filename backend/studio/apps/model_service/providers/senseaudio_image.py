from __future__ import annotations

import httpx

from studio.apps.model_service.providers._senseaudio import (
    ProviderTaskStatus,
    headers,
    response_json,
    root_url,
)

IMAGE_MODEL_SIZES: dict[str, tuple[str, ...]] = {
    "senseaudio-image-2.0-260319": (
        "1024x1024",
        "1536x864",
        "864x1536",
        "2016x864",
        "864x2016",
        "2048x1024",
        "1024x2048",
        "2048x1152",
        "1152x2048",
        "2688x1152",
        "1152x2688",
        "2688x1344",
        "1344x2688",
        "3840x1648",
        "1648x3840",
        "3840x1920",
        "1920x3840",
        "3840x2160",
        "2160x3840",
    ),
    "senseaudio-image-1.0-260319": (
        "1664x928",
        "928x1664",
        "1584x1056",
        "1056x1584",
        "1472x1140",
        "1140x1472",
        "1328x1328",
    ),
    "doubao-seedream-5-0-260128": (
        "2304x1728",
        "1728x2304",
        "2496x1664",
        "1664x2496",
        "2048x2048",
        "3136x1344",
        "2848x1600",
        "1600x2848",
        "3456x2592",
        "2592x3456",
        "2496x3744",
        "3744x2496",
        "4096x2304",
        "2304x4096",
        "3072x3072",
        "4704x2016",
    ),
    "sensenova-u1-fast": (
        "1664x2496",
        "2496x1664",
        "1760x2368",
        "2368x1760",
        "1824x2272",
        "2272x1824",
        "2048x2048",
        "2752x1536",
        "1536x2752",
        "3072x1376",
        "1344x3136",
    ),
}


async def create_image_task(
    *,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    size: str,
    seed: int | None = None,
    reference: str | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    body: dict[str, object] = {"model": model, "prompt": prompt, "size": size}
    if seed is not None:
        body["seed"] = seed
    if reference:
        body["reference"] = reference
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0), transport=transport) as client:
        payload = response_json(
            await client.post(
                f"{root_url(base_url)}/image/async",
                headers=headers(api_key),
                json=body,
            )
        )
    task_id = str(payload.get("task_id") or "")
    if not task_id:
        raise ValueError("SenseAudio 图片任务未返回 task_id")
    return task_id


async def get_image_task(
    *,
    base_url: str,
    api_key: str,
    task_id: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ProviderTaskStatus:
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), transport=transport) as client:
        payload = response_json(
            await client.get(
                f"{root_url(base_url)}/image/pending",
                headers=headers(api_key),
                params={"task_id": task_id},
            )
        )
    status = str(payload.get("status") or "pending")
    return ProviderTaskStatus(
        status=status,
        progress=100 if status == "completed" else 0,
        result_url=str(payload.get("url") or ""),
        error_message=str(payload.get("error_message") or ""),
    )
