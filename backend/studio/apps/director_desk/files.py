"""Project and library bytes for director desk. Documents keep only SHA-256 keys."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.config import get_settings
from studio.apps.director_desk.projects import DirectorDeskError, DirectorDeskProjects
from studio.apps.director_desk.schemas import FILE_KEY, DirectorFileOut

MAX_FILE_BYTES = 512 * 1024 * 1024
CHUNK = 1024 * 1024


def application_dir(owner_user_id: str, storage: AssetStorage | None = None) -> Path:
    settings = storage.settings if storage is not None else get_settings()
    if not owner_user_id or Path(owner_user_id).name != owner_user_id:
        raise DirectorDeskError("账号无效", 422, "invalid_account")
    return local_directory(settings.account_path(owner_user_id), "applications", "director-desk")


def local_directory(root: Path, *parts: str) -> Path:
    for part in parts:
        root = root / part
        if root.is_symlink():
            raise DirectorDeskError("导演台目录无效", 409, "invalid_file_layout")
    return root


class DirectorDeskFiles:
    def __init__(
        self, session: AsyncSession, owner_user_id: str, *, storage: AssetStorage | None = None
    ):
        self.session = session
        self.owner_user_id = owner_user_id
        self.projects = DirectorDeskProjects(session, owner_user_id)
        self.storage = storage if storage is not None else AssetStorage(get_settings())

    def project_dir(self, project_id: str) -> Path:
        project = self.storage.project_root(
            "director-desk", project_id, owner_user_id=self.owner_user_id
        )
        return local_directory(project, "files")

    def library_dir(self) -> Path:
        return local_directory(application_dir(self.owner_user_id, self.storage), "library")

    async def store_project_file(self, project_id: str, upload: IncomingFile) -> DirectorFileOut:
        await self.projects.row(project_id)
        await self.session.rollback()
        stage = local_directory(application_dir(self.owner_user_id, self.storage), ".uploads")

        async def publish(temp, key):
            await self.session.execute(text("BEGIN IMMEDIATE"))
            await self.projects.row(project_id)
            directory = self.project_dir(project_id)
            directory.mkdir(parents=True, exist_ok=True)
            os.replace(temp, directory / key)
            await self.session.commit()

        return await write_bytes(stage, upload, publish=publish)

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
            path = directory / key
            if FILE_KEY.fullmatch(key) is None or path.is_symlink() or not path.is_file():
                raise DirectorDeskError("动作资源文件不存在", 422, "missing_file")


def existing_file(directory: Path, key: str) -> Path:
    if FILE_KEY.fullmatch(key) is None:
        raise DirectorDeskError("文件不存在")
    path = directory / key
    if path.is_symlink() or not path.is_file():
        raise DirectorDeskError("文件不存在")
    return path


async def write_bytes(directory: Path, upload: IncomingFile, *, publish=None) -> DirectorFileOut:
    directory.mkdir(parents=True, exist_ok=True)
    temp_dir = local_directory(directory, ".tmp")
    temp_dir.mkdir(exist_ok=True)
    temp = temp_dir / f"{uuid4().hex}.tmp"
    hasher = hashlib.sha256()
    size = 0
    try:
        with temp.open("xb") as handle:
            while chunk := await upload.read(CHUNK):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise DirectorDeskError("文件超过 512MB", 413, "file_too_large")
                hasher.update(chunk)
                handle.write(chunk)
        if size == 0:
            raise DirectorDeskError("文件是空的", 422, "empty_file")
        key = hasher.hexdigest()
        if publish is None:
            os.replace(temp, directory / key)
        else:
            await publish(temp, key)
        return DirectorFileOut(key=key, size=size)
    finally:
        temp.unlink(missing_ok=True)
        await upload.close()
