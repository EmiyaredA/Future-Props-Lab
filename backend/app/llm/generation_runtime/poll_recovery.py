"""Safe recovery of provider-accepted tasks; never permits another submission."""

from __future__ import annotations

from typing import Any

import httpx

POLL_RETRY_PREFIX = "供应商状态查询暂时失败"
LEGACY_POLL_ERRORS = frozenset(
    f"任务处理失败（{name}）"
    for name in (
        "ConnectError",
        "ConnectTimeout",
        "ReadError",
        "ReadTimeout",
        "WriteError",
        "WriteTimeout",
        "PoolTimeout",
        "RemoteProtocolError",
        "ProxyError",
    )
)


def is_transient_poll_error(exc: Exception) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {
        408,
        429,
        500,
        502,
        503,
        504,
    }


def can_recover_generation_result(task: Any) -> bool:
    if task.status != "failed":
        return False
    if task.result_url:
        return True
    message = task.error_message or ""
    return bool(task.provider_task_id) and (
        message in LEGACY_POLL_ERRORS or message.startswith(POLL_RETRY_PREFIX)
    )
