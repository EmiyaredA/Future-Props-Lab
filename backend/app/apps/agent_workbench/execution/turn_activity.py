"""Project activity projection for owned Workbench transcripts."""

import time

from app.capabilities.agents.activity import positive_int, tool_details

from . import project_files
from .transcripts import get_turn
from .turn_records import begin


def managed_activity_details(name, payload):
    if name not in {"read_file", "write_file", "run_command"}:
        return None
    details = tool_details(name, payload)
    target = details.get("file") if details else None
    if target:
        try:
            project_files.path_parts(target["path"])
        except ValueError:
            return None
    return details


def next_activity_sequence(turn):
    return len(turn.activity) + len(turn.instructions) + len(turn.approvals)


async def record_activity(db, key, kind, payload):
    await begin(db)
    row = await get_turn(db, *key)
    if not apply_activity(row, kind, payload):
        return
    await db.commit()


def apply_activity(row, kind, payload):
    if row.status not in ("running", "waiting_approval"):
        return
    call_id = str(payload["tool_call_id"])[:255]
    activities = list(row.activity)
    index = next((i for i, item in enumerate(activities) if item["call_id"] == call_id), None)
    if kind == "tool_call" and index is None and len(activities) < 100:
        name = str(payload["tool_name"])[:120]
        activities.append(
            {
                "call_id": call_id,
                "name": name,
                "details": managed_activity_details(name, payload.get("arguments")),
                "opened_at_ms": int(time.time() * 1000),
                "sequence": next_activity_sequence(row),
                "status": "running",
                "offset": len(row.answer),
            }
        )
    elif kind == "tool_result" and index is not None:
        result = payload.get("result")
        failed = payload.get("status") != "completed" or (
            isinstance(result, dict)
            and ("error" in result or result.get("status") == "rejected" or result.get("exit_code"))
        )
        previous = activities[index]
        details = previous.get("details") or {}
        target = details.get("file") or {}
        path = target.get("path")
        source_available = (
            not failed
            and previous["name"] in {"read_file", "write_file"}
            and isinstance(path, str)
            and isinstance(result, dict)
            and result.get("path") == path
            and (
                isinstance(result.get("content"), str)
                if previous["name"] == "read_file"
                else isinstance(result.get("sha256"), str)
            )
        )
        started = previous.get("opened_at_ms")
        elapsed = (
            positive_int(int(time.time() * 1000) - started) if isinstance(started, int) else None
        )
        activities[index] = {
            **previous,
            "status": "failed" if failed else "completed",
            "source_available": source_available,
            "details": {**(details or {"kind": "duration"}), "duration_ms": elapsed}
            if elapsed
            else previous.get("details"),
        }
    else:
        return
    row.activity = activities
    row.revision += 1
    return True
