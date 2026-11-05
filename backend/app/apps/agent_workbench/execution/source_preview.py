"""Read the current file referenced by a successful managed project operation."""

import asyncio

from fastapi import HTTPException

from . import project_files, storage
from .schemas import SourcePreview


async def read(db, principal, chat_id, turn_id, call_id, *, local):
    project, _ = await storage.checked_project(db, principal, local=local, chat_id=chat_id)
    await storage.check_binding(db, principal, project, local=local, chat_id=chat_id)
    turn = await storage.get_turn(db, principal.user_id, chat_id, turn_id)
    activity = next((entry for entry in turn.activity if entry["call_id"] == call_id), {})
    name = activity.get("name")
    if (
        name not in {"read_file", "write_file"}
        or activity.get("status") != "completed"
        or activity.get("source_available") is not True
    ):
        raise HTTPException(404, "此操作没有可预览的源码")
    target = (activity.get("details") or {}).get("file") or {}
    path = target.get("path")
    if not isinstance(path, str):
        raise HTTPException(404, "此操作没有可预览的源码")
    diffs = [
        approval["preview"]
        for approval in turn.approvals
        if name == "write_file"
        and approval["kind"] == "write"
        and approval["title"] == path
        and approval["status"] == "completed"
    ]
    await db.rollback()
    try:
        content = await asyncio.to_thread(
            project_files.read_file,
            project.root,
            path,
            expected_root=project.directory_key,
        )
    except (OSError, ValueError):
        content = None
    if content is None:
        raise HTTPException(404, "文件已移除或无法预览")
    # Recheck revocation and project reassignment that may have raced the read.
    await storage.check_binding(db, principal, project, local=local, chat_id=chat_id)
    return SourcePreview(
        path=path,
        text=content,
        line=target.get("line"),
        diff=diffs[0] or None if len(diffs) == 1 else None,
    )
