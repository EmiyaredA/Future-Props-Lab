"""Shared task transitions that need no provider or worker configuration."""

from __future__ import annotations

from typing import Any

import httpx
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.runtime.time import utc_now

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


async def cancel_queued(session: AsyncSession, task: Any, revision: int) -> bool:
    task_type = type(task)
    result = await session.execute(
        update(task_type)
        .where(
            task_type.id == task.id,
            task_type.revision == revision,
            task_type.status == "queued",
            task_type.provider_task_id.is_(None),
            task_type.generation_kind.in_(("image", "video")),
        )
        .values(
            status="cancelled",
            revision=revision + 1,
            updated_at=utc_now(),
            completed_at=utc_now(),
        )
    )
    return result.rowcount == 1
