"""Project and library bytes for director desk. Documents keep only SHA-256 keys."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.director_desk.projects import DirectorDeskError, DirectorDeskProjects
from app.apps.director_desk.schemas import FILE_KEY, DirectorFileOut
from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.config import get_settings

MAX_FILE_BYTES = 512 * 1024 * 1024
CHUNK = 1024 * 1024


def application_dir(workspace_id: str) -> Path:
    settings = get_settings()
    if workspace_id == "default":
        return (settings.runtime_path / "applications" / "director-desk").resolve()
    if not workspace_id or Path(workspace_id).name != workspace_id:
        raise DirectorDeskError("工作区无效", 422, "invalid_workspace")
    return (settings.workspace_path(workspace_id) / "applications" / "director-desk").resolve()


class DirectorDeskFiles:
    def __init__(self, session: AsyncSession, workspace_id: str):
        self.session = session
        self.workspace_id = workspace_id
        self.projects = DirectorDeskProjects(session, workspace_id)
        self.storage = AssetStorage(get_settings())

    def project_dir(self, project_id: str) -> Path:
        return (
            self.storage.project_root("director-desk", project_id, workspace_id=self.workspace_id)
            / "files"
        )

    def library_dir(self) -> Path:
        return application_dir(self.workspace_id) / "library"

    async def store_project_file(self, project_id: str, upload: IncomingFile) -> DirectorFileOut:
        await self.projects.row(project_id)
        await self.session.rollback()
        return await write_bytes(self.project_dir(project_id), upload)

    async def store_library_file(self, upload: IncomingFile) -> DirectorFileOut:
        return await write_bytes(self.library_dir(), upload)

    async def project_file(self, project_id: str, key: str) -> Path:
        await self.projects.row(project_id)
        return existing_file(self.project_dir(project_id), key)

    def library_file(self, key: str) -> Path:
        return existing_file(self.library_dir(), key)

    def require_library_keys(self, keys: set[str]) -> None:
        directory = self.library_dir()
        for key in keys:
            if FILE_KEY.fullmatch(key) is None or not (directory / key).is_file():
                raise DirectorDeskError("动作资源文件不存在", 422, "missing_file")


def existing_file(directory: Path, key: str) -> Path:
    if FILE_KEY.fullmatch(key) is None:
        raise DirectorDeskError("文件不存在")
    path = directory / key
    if not path.is_file():
        raise DirectorDeskError("文件不存在")
    return path


async def write_bytes(directory: Path, upload: IncomingFile) -> DirectorFileOut:
    directory.mkdir(parents=True, exist_ok=True)
    temp_dir = directory / ".tmp"
    temp_dir.mkdir(exist_ok=True)
    temp = temp_dir / f"{uuid4().hex}.tmp"
    hasher = hashlib.sha256()
    size = 0
    try:
        with temp.open("wb") as handle:
            while chunk := await upload.read(CHUNK):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise DirectorDeskError("文件超过 512MB", 413, "file_too_large")
                hasher.update(chunk)
                handle.write(chunk)
        if size == 0:
            raise DirectorDeskError("文件是空的", 422, "empty_file")
        key = hasher.hexdigest()
        os.replace(temp, directory / key)
        return DirectorFileOut(key=key, size=size)
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()
