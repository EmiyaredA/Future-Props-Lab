from __future__ import annotations

import asyncio
import platform
import subprocess
from pathlib import Path
from typing import Protocol


class FolderLocations(Protocol):
    """The caller has authorized the account and supplies its owned layout adapter."""

    def project_root(self, application_id: str, project_id: str, *, owner_user_id: str) -> Path: ...

    def target_root(
        self,
        *,
        visual_project_id: str | None,
        galgame_project_id: str | None,
        video_editor_project_id: str | None = None,
        owner_user_id: str,
    ) -> Path: ...


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
    storage: FolderLocations,
    application_id: str,
    project_id: str,
    *,
    owner_user_id: str,
) -> None:
    path = storage.project_root(application_id, project_id, owner_user_id=owner_user_id)
    if not path.is_dir():
        raise ProjectFolderError(
            "项目文件夹不存在",
            code="project_folder_missing",
            status=409,
        )
    await asyncio.to_thread(_open_folder, path)


async def open_library_folder(storage: FolderLocations, *, owner_user_id: str) -> None:
    path = storage.target_root(
        visual_project_id=None,
        galgame_project_id=None,
        video_editor_project_id=None,
        owner_user_id=owner_user_id,
    )
    if not path.is_dir():
        raise ProjectFolderError(
            "文件库文件夹不存在",
            code="library_folder_missing",
            status=409,
        )
    await asyncio.to_thread(_open_folder, path)
