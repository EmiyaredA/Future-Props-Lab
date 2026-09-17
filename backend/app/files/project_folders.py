from __future__ import annotations

import asyncio
import platform
import subprocess
from pathlib import Path

from app.files.storage import AssetStorage


class ProjectFolderError(Exception):
    def __init__(self, message: str, *, code: str, status: int) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def _open_folder(path: Path) -> None:
    system = platform.system()
    if system == "Darwin":
        command = ["open", str(path)]
    elif system == "Windows":
        command = ["explorer", str(path)]
    elif system == "Linux":
        command = ["xdg-open", str(path)]
    else:
        raise ProjectFolderError(
            "当前操作系统不支持直接打开项目文件夹",
            code="folder_open_unsupported",
            status=501,
        )
    try:
        subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
    except (FileNotFoundError, OSError) as exc:
        raise ProjectFolderError(
            "无法启动系统文件管理器",
            code="folder_open_unavailable",
            status=503,
        ) from exc


async def open_project_folder(
    storage: AssetStorage,
    application_id: str,
    project_id: str,
    *,
    workspace_id: str,
) -> None:
    path = storage.project_root(application_id, project_id, workspace_id=workspace_id)
    if not path.is_dir():
        raise ProjectFolderError(
            "项目文件夹不存在",
            code="project_folder_missing",
            status=409,
        )
    await asyncio.to_thread(_open_folder, path)


async def open_library_folder(storage: AssetStorage, *, workspace_id: str) -> None:
    path = storage.target_root(
        visual_project_id=None,
        galgame_project_id=None,
        video_editor_project_id=None,
        workspace_id=workspace_id,
    )
    if not path.is_dir():
        raise ProjectFolderError(
            "文件库文件夹不存在",
            code="library_folder_missing",
            status=409,
        )
    await asyncio.to_thread(_open_folder, path)
