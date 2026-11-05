"""Read the current file referenced by a successful managed project operation."""

import asyncio

from fastapi import HTTPException

from studio.apps.agent_workbench.execution import project_files, storage, transcripts
from studio.apps.agent_workbench.execution.schemas import SourcePreview
from studio.apps.agent_workbench.execution.turn_activity import source_reference


async def read(db, principal, chat_id, turn_id, call_id, *, load_settings, local):
    project, _ = await storage.checked_project(
        db, principal, local=local, chat_id=chat_id, load_settings=load_settings
    )
    await storage.check_binding(
        db, principal, project, local=local, chat_id=chat_id, load_settings=load_settings
    )
    turn = await transcripts.get_turn(db, principal.user_id, chat_id, turn_id)
    path, line, diff = source_reference(turn, call_id)
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
    await storage.check_binding(
        db, principal, project, local=local, chat_id=chat_id, load_settings=load_settings
    )
    return SourcePreview(
        path=path,
        text=content,
        line=line,
        diff=diff,
    )
