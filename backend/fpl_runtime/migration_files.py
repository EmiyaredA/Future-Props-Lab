"""Verify and durably publish frozen migration originals without replacing existing files."""

import asyncio
import hashlib
import os
import stat
from uuid import uuid4


def checked_path(root, *parts):
    path = root.resolve()
    for part in parts:
        if (
            not isinstance(part, str)
            or not part
            or part in {".", ".."}
            or "/" in part
            or "\\" in part
        ):
            raise ValueError("迁移文件路径片段无效")
        path /= part
        if path.is_symlink():
            raise ValueError("迁移文件路径不能包含符号链接")
    return path


def inventory_directory(path):
    if path.is_symlink() or (path.exists() and not path.is_dir()):
        raise ValueError("迁移目录必须为真实目录")
    return path.iterdir() if path.exists() else iter(())


def inspect_blob(path, *, exact_size=None, maximum=None):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        before = os.fstat(stream.fileno())
        size = before.st_size
        if (
            not stat.S_ISREG(before.st_mode)
            or size <= 0
            or (exact_size is not None and size != exact_size)
            or (maximum is not None and size > maximum)
        ):
            raise ValueError("迁移文件类型或长度无效")
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
        after = os.fstat(stream.fileno())
    if (after.st_size, after.st_mtime_ns) != (size, before.st_mtime_ns):
        raise ValueError("迁移文件在读取期间变化")
    return size, digest


def publish_blob(root, target, staged, size, digest):
    if root not in target.parents:
        raise ValueError("迁移目标路径越界")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(staged, target, follow_symlinks=False)
    except FileExistsError:
        if inspect_blob(target, exact_size=size)[1] != digest:
            raise ValueError("迁移目标文件内容冲突") from None
    for parent in target.parents:
        descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        if parent == root:
            break


async def import_blob(stream, *, root, target, staging, size, digest):
    if staging.is_symlink():
        raise ValueError("迁移暂存目录不能是符号链接")
    staging.mkdir(mode=0o700, parents=True, exist_ok=True)
    pending = staging / f"{uuid4().hex}.part"
    hasher = hashlib.sha256()
    received = 0
    try:
        with os.fdopen(
            os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"
        ) as handle:
            async for chunk in stream:
                received += len(chunk)
                if received > size:
                    raise ValueError("迁移文件长度不符")
                hasher.update(chunk)
                await asyncio.to_thread(handle.write, chunk)
            if received != size or hasher.hexdigest() != digest:
                raise ValueError("迁移文件摘要或长度不符")
            handle.flush()
            os.fsync(handle.fileno())
        await asyncio.to_thread(publish_blob, root, target, pending, size, digest)
    finally:
        pending.unlink(missing_ok=True)
