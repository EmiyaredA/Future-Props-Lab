"""AutoDL ComfyUI protocol normalized for the shared generation driver."""

import json
from typing import Any
from urllib.parse import quote

import httpx

from studio.apps.model_service.providers._senseaudio import (
    ProviderTaskStatus,
    sanitize_provider_message,
)
from studio.apps.model_service.providers.autodl_workflows import BASE_URL, prepare_payload
from studio.runtime.http.outbound_urls import require_safe_provider_base_url


def root_url(base_url: str) -> str:
    return require_safe_provider_base_url(base_url or BASE_URL).rstrip("/")


def response_data(response: httpx.Response, api_key: str) -> dict[str, Any]:
    def safe(value):
        return sanitize_provider_message(
            str(value).replace(api_key, "[REDACTED]") if api_key else str(value)
        )[:1000]

    try:
        body = response.json()
    except ValueError:
        raise ValueError(f"AutoDL 返回无效 JSON（HTTP {response.status_code}）") from None
    if not isinstance(body, dict):
        raise ValueError("AutoDL 返回无效响应")
    if response.is_error or str(body.get("code", "")).lower() != "success":
        detail = safe(body.get("msg") or body.get("message") or "未知错误")
        raise ValueError(f"AutoDL 请求失败（HTTP {response.status_code}）: {detail}")
    if not isinstance(body.get("data"), dict):
        raise ValueError("AutoDL 返回无效任务数据")
    return body["data"]


async def create_task(
    *, base_url: str, api_key: str, model: str, payload: dict, content: list[dict], transport=None
) -> str:
    wire = prepare_payload(model, payload, content)
    encoded = json.dumps(wire, ensure_ascii=False).encode()
    if len(encoded) > 64 * 1024 * 1024:
        raise ValueError("AutoDL 参考素材请求体超过应用的 64 MB 限制")
    async with httpx.AsyncClient(timeout=120, transport=transport) as client:
        data = response_data(
            await client.post(
                f"{root_url(base_url)}/api/v1/comfyui/comfyui_workflow/{quote(model, safe='')}",
                headers={"Authorization": api_key, "Content-Type": "application/json"},
                content=encoded,
            ),
            api_key,
        )
    task_id = data.get("task_id")
    if not isinstance(task_id, str) or not task_id.strip():
        raise ValueError("AutoDL 提交未返回 task_id")
    return task_id


async def get_task(
    *, base_url: str, api_key: str, task_id: str, transport=None
) -> ProviderTaskStatus:
    async with httpx.AsyncClient(timeout=30, transport=transport) as client:
        data = response_data(
            await client.get(
                f"{root_url(base_url)}/api/v1/comfyui/comfyui_workflow/result/"
                f"{quote(task_id, safe='')}",
                headers={"Authorization": api_key},
            ),
            api_key,
        )
    status = str(data.get("status") or "").lower()
    if status in {"success", "completed"}:
        for item in data.get("results") or []:
            if (
                isinstance(item, dict)
                and item.get("type") == "video"
                and isinstance(item.get("url"), str)
                and item["url"]
            ):
                return ProviderTaskStatus("completed", 100, item["url"])
        raise ValueError("AutoDL 已完成任务但未返回视频地址")
    if status in {"failed", "error", "cancelled", "canceled"}:
        message = str(data.get("error") or data.get("message") or "AutoDL 任务失败")
        return ProviderTaskStatus(
            "failed",
            error_message=sanitize_provider_message(
                message.replace(api_key, "[REDACTED]") if api_key else message
            ),
        )
    if status in {"queued", "pending"}:
        return ProviderTaskStatus("pending")
    if status in {"running", "processing"}:
        return ProviderTaskStatus("processing")
    raise ValueError("AutoDL 返回未知任务状态")
