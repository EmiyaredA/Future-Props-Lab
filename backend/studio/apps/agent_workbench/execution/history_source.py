"""Read a native conversation's file only through an authorized project binding."""

import asyncio

from fastapi import HTTPException
from sqlalchemy import select

from studio.apps.agent_workbench import reading
from studio.apps.agent_workbench.execution import project_files, storage
from studio.apps.agent_workbench.execution.models import WorkbenchProject
from studio.apps.agent_workbench.execution.schemas import SourcePreview
from studio.contracts.agent_workbench.execution import relative_history_path


async def project_for_history(db, owner, cwd, *, load_settings, local):
    if local:
        identity = await db.scalar(
            select(WorkbenchProject.id).where(
                WorkbenchProject.owner_user_id == owner, WorkbenchProject.root == cwd
            )
        )
        if identity:
            return identity
    settings = await asyncio.to_thread(load_settings)
    for identity, project in settings.fpl_cloud_control_projects.items():
        if project.root == cwd and owner in project.user_ids:
            return identity
    raise HTTPException(
        403, "此会话的项目尚未授权阅读。请在本机新会话中选择此项目；公网需配置项目授权。"
    )


def relative_path(cwd, path):
    try:
        path = relative_history_path(cwd, path)
    except ValueError:
        raise HTTPException(404, "文件不在会话项目内") from None
    # Reject traversal before any disk I/O, including hidden/private files.
    try:
        project_files.path_parts(path)
    except ValueError:
        raise HTTPException(404, "文件不在可阅读的项目范围内") from None
    return path


async def read(db, principal, session_id, path, line, *, load_settings, local):
    conversation = await reading.get_conversation(db, principal.user_id, session_id)
    cwd = conversation.cwd
    path = relative_path(cwd, path)
    identity = await project_for_history(
        db, principal.user_id, cwd, local=local, load_settings=load_settings
    )
    project, _ = await storage.checked_project(
        db, principal, project_id=identity, local=local, load_settings=load_settings
    )
    if project.root != cwd:
        raise HTTPException(409, "项目绑定已变更，请重新打开文件")
    await db.rollback()
    try:
        content = await asyncio.to_thread(
            project_files.read_file, project.root, path, expected_root=project.directory_key
        )
    except (OSError, ValueError):
        content = None
    if content is None:
        raise HTTPException(404, "文件已移除、超过 128 KiB 或不是可阅读的 UTF-8 文本")
    await storage.check_binding(db, principal, project, local=local, load_settings=load_settings)
    current = await reading.get_conversation(db, principal.user_id, session_id)
    if current.cwd != cwd:
        raise HTTPException(409, "会话项目已变更，请重新打开文件")
    return SourcePreview(path=path, text=content, line=line)
