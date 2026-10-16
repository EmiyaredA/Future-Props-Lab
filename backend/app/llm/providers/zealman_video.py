"""ZEALMAN HTTP protocol; public callers only receive normalized task states."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin, urlsplit, urlunsplit
from uuid import uuid4

import httpx

from app.llm.providers._senseaudio import ProviderTaskStatus, sanitize_provider_message
from app.llm.providers.zealman_workflows import prepare_workflow
from app.runtime.outbound_urls import require_safe_provider_base_url


def root_url(base_url: str) -> str:
    parsed = urlsplit(require_safe_provider_base_url(base_url))
    if not parsed.hostname:
        raise ValueError("ZEALMAN 必须配置服务地址")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"} if api_key else {}


def response_json(response: httpx.Response) -> dict[str, Any]:
    if response.is_error:
        try:
            error = response.json()
            detail = error.get("error") or error.get("message") or error.get("detail") or ""
        except (ValueError, AttributeError):
            detail = ""
        safe = sanitize_provider_message(str(detail))[:1000]
        raise ValueError(f"ZEALMAN 请求失败（HTTP {response.status_code}）: {safe}")
    try:
        body = response.json()
    except ValueError:
        raise ValueError("ZEALMAN 返回了无效 JSON") from None
    if not isinstance(body, dict):
        raise ValueError("ZEALMAN 返回了无效响应")
    if body.get("success") is False or body.get("error"):
        raise ValueError(
            "ZEALMAN: " + sanitize_provider_message(str(body.get("error") or "请求失败"))[:1000]
        )
    return body


async def upload_reference(
    *,
    base_url: str,
    api_key: str,
    path: Path,
    mime_type: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    extension = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "video/mp4": ".mp4",
        "video/quicktime": ".mov",
    }[mime_type]
    async with httpx.AsyncClient(timeout=120, transport=transport) as client:
        with path.open("rb") as source:
            body = response_json(
                await client.post(
                    f"{root_url(base_url)}/api/comfy/upload/file",
                    headers=headers(api_key),
                    files={"file": (f"fpl-{uuid4().hex}{extension}", source, mime_type)},
                    data={"overwrite": "false"},
                )
            )
    name = body.get("name")
    subfolder = body.get("subfolder", "")
    if not isinstance(name, str) or not name or not isinstance(subfolder, str):
        raise ValueError("ZEALMAN 上传未返回文件名")
    return f"{subfolder}/{name}" if subfolder else name


async def create_task(
    *,
    base_url: str,
    api_key: str,
    model: str,
    payload: dict[str, Any],
    references: dict[str, list[str]],
    transport: httpx.AsyncBaseTransport | None = None,
) -> str:
    root = root_url(base_url)
    async with httpx.AsyncClient(timeout=120, transport=transport) as client:
        template = response_json(
            await client.get(
                f"{root}/api/workflows/download/{quote(model + '.json', safe='')}",
                headers=headers(api_key),
            )
        )
        graph = prepare_workflow(template, model, payload, references)
        body = response_json(
            await client.post(
                f"{root}/api/workflow/generate",
                headers=headers(api_key),
                json={"workflow_id": model, "workflow_template": graph, "source": "api"},
            )
        )
    identity = body.get("prompt_id")
    if not isinstance(identity, str) or not identity:
        raise ValueError("ZEALMAN 提交未返回 prompt_id")
    return identity


def result_status(body: dict[str, Any], root: str) -> ProviderTaskStatus | None:
    for item in body.get("results") or body.get("outputs") or []:
        if isinstance(item, dict) and item.get("type") == "video" and item.get("url"):
            return ProviderTaskStatus("completed", 100, urljoin(root + "/", item["url"]))
    if body.get("status") in {"error", "failed", "cancelled"} or body.get("error"):
        return ProviderTaskStatus("failed", error_message=str(body.get("error") or "上游任务失败"))
    return None


async def get_task(
    *,
    base_url: str,
    api_key: str,
    task_id: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ProviderTaskStatus:
    root = root_url(base_url)
    async with httpx.AsyncClient(timeout=30, transport=transport) as client:
        body = response_json(
            await client.get(
                f"{root}/api/workflow/result",
                params={"prompt_id": task_id},
                headers=headers(api_key),
            )
        )
        status = result_status(body, root)
        if status:
            return status
        history_response = await client.get(
            f"{root}/api/comfy/proxy/history",
            params={"prompt_id": task_id},
            headers=headers(api_key),
        )
        history = response_json(history_response).get(task_id, {})
        execution = history.get("status", {})
        if execution.get("status_str") == "error":
            messages = execution.get("messages", [])
            detail = next(
                (
                    v.get("exception_message")
                    for k, v in messages
                    if k == "execution_error" and isinstance(v, dict)
                ),
                "上游执行失败",
            )
            return ProviderTaskStatus("failed", error_message=str(detail))
        ledger_response = await client.get(
            f"{root}/api/tasks/{quote(task_id, safe='')}", headers=headers(api_key)
        )
        if ledger_response.status_code != 404:
            ledger = response_json(ledger_response)
            task = ledger.get("task", ledger)
            status = result_status(task, root)
            if status:
                return status
        if body.get("pending") is False:
            return ProviderTaskStatus("failed", error_message="ZEALMAN 已完成任务但未返回视频")
    return ProviderTaskStatus("pending")
