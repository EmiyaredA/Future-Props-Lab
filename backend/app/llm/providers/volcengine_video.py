"""Native Ark asynchronous video protocol; no provider events escape this adapter."""

import json
from urllib.parse import quote

import httpx

from app.llm.providers._senseaudio import ProviderTaskStatus, sanitize_provider_message
from app.llm.providers.seedance_parameters import normalize_video_parameters
from studio.runtime.http.outbound_urls import require_safe_provider_base_url

ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"


def native_content(content: list[dict]) -> list[dict]:
    result = []
    for item in content:
        kind = item["type"]
        if kind == "text":
            if item.get("text"):
                result.append({"type": "text", "text": item["text"]})
            continue
        if kind not in {"image", "audio", "video"}:
            raise ValueError("不支持的方舟参考素材类型")
        field = f"{kind}_url"
        url = item.get("url") if kind == "image" else item.get(field)
        role = item.get("role")
        role = role if role in {"first_frame", "last_frame"} else f"reference_{kind}"
        result.append({"type": field, field: {"url": url}, "role": role})
    return result


def _response(response: httpx.Response) -> dict:
    try:
        value = response.json()
    except ValueError as exc:
        raise ValueError("方舟视频接口返回了无效 JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("方舟视频接口返回了无效响应")
    if response.is_error:
        error = value.get("error") or {}
        message = error.get("message", "") if isinstance(error, dict) else str(error)
        raise ValueError(
            f"方舟视频请求失败（HTTP {response.status_code}）：{sanitize_provider_message(message)}"
        )
    return value


async def create_task(
    *, base_url: str, api_key: str, model: str, payload: dict, content: list[dict], transport=None
) -> str:
    params = normalize_video_parameters("volcengine_video", model, payload)
    body = {
        "model": model,
        "content": native_content(content),
        **{
            key: params[key]
            for key in ("duration", "resolution", "ratio", "watermark", "generate_audio")
        },
    }
    if model == "doubao-seedance-2-5-260628":
        body["output_format"] = "mp4"
        if any(i.get("role", "").startswith("reference_") for i in body["content"]):
            body["omni_reference_task_type"] = "reference"
    if len(json.dumps(body, ensure_ascii=False).encode()) > 64 * 1024 * 1024:
        raise ValueError("参考素材请求体超过方舟的 64 MB 限制")
    root = require_safe_provider_base_url(base_url or ARK_BASE_URL).rstrip("/")
    async with httpx.AsyncClient(timeout=120, transport=transport) as client:
        result = _response(
            await client.post(
                f"{root}/contents/generations/tasks",
                headers={"Authorization": f"Bearer {api_key}"},
                json=body,
            )
        )
    task_id = result.get("id")
    if not isinstance(task_id, str) or not task_id.strip():
        raise ValueError("方舟视频接口未返回任务 ID")
    return task_id


async def get_task(*, base_url: str, api_key: str, task_id: str, transport=None):
    root = require_safe_provider_base_url(base_url or ARK_BASE_URL).rstrip("/")
    async with httpx.AsyncClient(timeout=30, transport=transport) as client:
        value = _response(
            await client.get(
                f"{root}/contents/generations/tasks/{quote(task_id, safe='')}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        )
    status = value.get("status")
    states = {
        "queued": "pending",
        "running": "processing",
        "succeeded": "completed",
        "failed": "failed",
        "cancelled": "failed",
        "expired": "failed",
    }
    if status not in states:
        raise ValueError("方舟视频接口返回了未知任务状态")
    error = value.get("error") or {}
    message = error.get("message", "") if isinstance(error, dict) else str(error)
    if status in {"cancelled", "expired"}:
        message = "供应商任务已取消" if status == "cancelled" else "供应商任务已过期"
    return ProviderTaskStatus(
        status=states[status],
        progress=100 if status == "succeeded" else 0,
        result_url=str((value.get("content") or {}).get("video_url") or ""),
        error_message=sanitize_provider_message(message),
    )
