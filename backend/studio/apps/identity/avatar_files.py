"""Owned avatar lookup, inventory and durable file publication for maintenance."""

import asyncio
import hashlib
import os
import re
import stat
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from studio.apps.identity.profile import AVATAR_MAX_BYTES, CONTENT_TYPES
from studio.apps.identity.storage.models.accounts import User

DIGEST_PATTERN = r"^[a-f0-9]{64}$"


def avatar_filename(owner, path, content_type, digest):
    if not path:
        if content_type or digest:
            raise ValueError("头像元数据不完整")
        return None
    suffix = CONTENT_TYPES.get(content_type)
    filename = f"{digest}{suffix}"
    if suffix is None or not re.fullmatch(DIGEST_PATTERN, digest) or path != f"{owner}/{filename}":
        raise ValueError("头像归属路径或摘要无效")
    return filename


async def lookup(sessions, owner):
    async with sessions() as session:
        row = (
            await session.execute(
                select(
                    User.avatar_relative_path, User.avatar_content_type, User.avatar_content_sha256
                ).where(User.id == str(owner))
            )
        ).one_or_none()
    if row is None:
        raise HTTPException(409, {"code": "migration_owner_missing"})
    try:
        filename = avatar_filename(str(owner), *row)
    except ValueError:
        raise HTTPException(409, {"code": "migration_avatar_metadata_invalid"}) from None
    return filename, row.avatar_content_type, row.avatar_content_sha256


def read_file(path, expected):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= AVATAR_MAX_BYTES:
            raise ValueError("头像文件格式无效")
        data = stream.read(AVATAR_MAX_BYTES + 1)
    if len(data) != info.st_size or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("头像文件摘要不匹配")
    return data


def avatar_path(root, owner, filename):
    parent = root / str(owner)
    if root.is_symlink() or parent.is_symlink():
        raise ValueError("头像文件目录禁止符号链接")
    return parent / filename


def sync_directories(*paths):
    for path in paths:
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def store_file(path, digest, data):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    staging = path.parent.parent / ".staging"
    if staging.is_symlink():
        raise ValueError("头像暂存目录禁止符号链接")
    staging.mkdir(mode=0o700, exist_ok=True)
    staged = staging / f".import-{uuid4().hex}"
    try:
        with os.fdopen(
            os.open(staged, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"
        ) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(staged, path, follow_symlinks=False)
        except FileExistsError:
            read_file(path, digest)
    finally:
        staged.unlink(missing_ok=True)
    sync_directories(path.parent, path.parent.parent, path.parent.parent.parent)


def file_inventory(root: Path, expected, *, legacy_host_directory=None):
    if root.is_symlink() or (root.exists() and not root.is_dir()):
        raise ValueError("头像根目录无效")
    found = set()
    if root.is_dir():
        for folder in root.iterdir():
            if (
                folder.name in {".staging", legacy_host_directory}
                and folder.is_dir()
                and not folder.is_symlink()
            ):
                continue
            if folder.is_symlink() or not folder.is_dir():
                raise ValueError("存在未登记的头像文件")
            for path in folder.iterdir():
                relative = path.relative_to(root).as_posix()
                if path.is_symlink() or not path.is_file() or relative not in expected:
                    raise ValueError("存在未登记的头像文件")
                found.add(relative)
    return found


async def inventory_files(sessions, root, *, require_all, legacy_host_directory=None):
    async with sessions() as session:
        paths = set(
            await session.scalars(
                select(User.avatar_relative_path).where(User.avatar_relative_path != "")
            )
        )
    try:
        found = await asyncio.to_thread(
            file_inventory, root, paths, legacy_host_directory=legacy_host_directory
        )
    except (ValueError, OSError):
        raise HTTPException(409, {"code": "migration_avatar_inventory_conflict"}) from None
    if require_all and found != paths:
        raise HTTPException(409, {"code": "migration_avatar_file_missing"})
    return len(found)
