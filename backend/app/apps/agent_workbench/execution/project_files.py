"""Project file tools with descriptor-relative traversal and bounded text I/O."""

import hashlib
import os
import secrets
import stat
from contextlib import ExitStack, contextmanager
from pathlib import Path, PurePosixPath

from fastapi import HTTPException

from app.console.cloud_control.project_paths import validate_project_root, visible
from app.runtime.config import get_cloud_settings

MAX_FILE_BYTES = 128 * 1024


def project_for(project_id, owner):
    settings = get_cloud_settings()
    project = settings.fpl_cloud_control_projects.get(project_id)
    if project is None or owner not in project.user_ids:
        raise HTTPException(404, "项目未授权")
    validate_project_root(project.root, settings)
    return project


def path_parts(relative, *, allow_root=False):
    path = PurePosixPath(relative)
    if allow_root and relative in ("", "."):
        return ()
    if (
        path.is_absolute()
        or not path.parts
        or any(not visible(part) for part in relative.split("/"))
        or "\\" in relative
        or "\x00" in relative
    ):
        raise ValueError("路径超出项目范围")
    return path.parts


@contextmanager
def directory_fd(root, parts=()):
    with ExitStack() as stack:
        parent = None
        for part in (*Path(root).parts, *parts):
            parent = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            stack.callback(os.close, parent)
        yield parent


def list_files(root, path):
    with directory_fd(root, path_parts(path, allow_root=True)) as folder:
        items = []
        with os.scandir(folder) as entries:
            for entry in entries:
                if not visible(entry.name):
                    continue
                if entry.is_dir(follow_symlinks=False):
                    items.append(entry.name + "/")
                elif (
                    entry.is_file(follow_symlinks=False)
                    and entry.stat(follow_symlinks=False).st_nlink == 1
                ):
                    items.append(entry.name)
                if len(items) >= 250:
                    break
        return {"items": sorted(items), "limited": len(items) == 250}


def _read(folder, name):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder)
    except FileNotFoundError:
        return None, 0o644
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("只能访问普通项目文件")
        body = stream.read(MAX_FILE_BYTES + 1)
        if len(body) > MAX_FILE_BYTES or b"\x00" in body:
            raise ValueError("文件不是受支持的文本")
        return body, info.st_mode & 0o777


def read_file(root, relative):
    *parents, name = path_parts(relative)
    with directory_fd(root, parents) as folder:
        content, _ = _read(folder, name)
    return None if content is None else content.decode("utf-8")


def digest(content):
    return None if content is None else hashlib.sha256(content.encode()).hexdigest()


def write_file(root, relative, content, expected):
    *parents, name = path_parts(relative)
    body = content.encode()
    if len(body) > MAX_FILE_BYTES or b"\x00" in body:
        raise ValueError("文件不是受支持的文本")
    with directory_fd(root, parents) as folder:
        current, mode = _read(folder, name)
        temporary = ".fpl-write-" + secrets.token_hex(12)
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode, dir_fd=folder)
        try:
            with os.fdopen(descriptor, "wb") as output:
                if current is not None:
                    os.fchmod(output.fileno(), mode)
                output.write(body)
                output.flush()
                os.fsync(output.fileno())
            latest, _ = _read(folder, name)
            actual = None if latest is None else hashlib.sha256(latest).hexdigest()
            if latest != current or actual != expected:
                raise ValueError("文件已变更，请重新生成修改预览")
            if latest is None:
                os.link(temporary, name, src_dir_fd=folder, dst_dir_fd=folder)
            else:
                os.replace(temporary, name, src_dir_fd=folder, dst_dir_fd=folder)
        finally:
            try:
                os.unlink(temporary, dir_fd=folder)
            except FileNotFoundError:
                pass
    return {"path": relative, "sha256": digest(content)}
