"""Normalize optional ZEALMAN ledger and queue information."""

import math
from typing import Any

from app.llm.task_execution import TaskExecutionInfo
from studio.runtime.time import utc_now


def queue_entry(queue: dict, bucket: str, task_id: str) -> tuple[int, dict] | None:
    entries = queue.get(bucket)
    if not isinstance(entries, list):
        return None
    for position, entry in enumerate(entries, 1):
        if isinstance(entry, list) and len(entry) > 1 and entry[1] == task_id:
            graph = entry[2] if len(entry) > 2 and isinstance(entry[2], dict) else {}
            return position, graph
    return None


def execution_info(task_id: str, ledger: dict, queue: dict | None) -> TaskExecutionInfo:
    pending = queue_entry(queue or {}, "queue_pending", task_id)
    running = queue_entry(queue or {}, "queue_running", task_id)
    status = ledger.get("status")
    if not isinstance(status, str):
        status = ""
    phase = "unknown"
    if pending:
        phase = "queued"
    elif running:
        phase = "running"
    elif status in {"completed", "success"}:
        phase = "finalizing"
    elif queue is None:
        phase = {"running": "running", "pending": "queued", "queued": "queued"}.get(
            status, "unknown"
        )
    value: Any = ledger.get("progress")
    progress = (
        float(value)
        if isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and 0 <= value <= 100
        else None
    )
    return TaskExecutionInfo(
        phase=phase,
        queue_position=pending[0] if pending else None,
        reported_progress=progress,
        updated_at=utc_now(),
    )
