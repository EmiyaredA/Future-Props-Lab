"""Per-conversation working files; no path can escape its workspace root."""

from __future__ import annotations

import hashlib
import os
import stat
import subprocess
import sys
import uuid
from pathlib import Path

from app.runtime.config import get_settings
from app.runtime.operation_receipts import OperationError

KINDS = frozenset({"imports", "scripts", "outputs"})
MAX_FILE_BYTES = 50 * 1024 * 1024


def work_root(workspace_id: str, conversation_id: str) -> Path:
    if Path(conversation_id).name != conversation_id or not conversation_id:
        raise OperationError("会话 ID 无效")
    return get_settings().workspace_path(workspace_id) / "amadeus" / conversation_id


def work_file(workspace_id: str, conversation_id: str, kind: str, name: str) -> Path:
    if kind not in KINDS or not name or Path(name).name != name or name in {".", ".."}:
        raise OperationError("文件路径无效")
    root = work_root(workspace_id, conversation_id)
    target = root / kind / name
    if root.is_symlink() or (root / kind).is_symlink() or target.is_symlink():
        raise OperationError("不允许符号链接")
    if not target.resolve().is_relative_to(root.resolve()):
        raise OperationError("文件路径越界")
    return target


def read_file(workspace_id: str, conversation_id: str, kind: str, name: str) -> Path:
    target = work_file(workspace_id, conversation_id, kind, name)
    if not target.is_file():
        raise OperationError("文件不存在", "not_found", 404)
    return target


def _directory_fd(workspace_id: str, conversation_id: str, kind: str, *, create: bool) -> int:
    root = work_root(workspace_id, conversation_id)
    try:
        if create:
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        root_fd = os.open(root, flags)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise OperationError("会话目录不存在", "not_found", 404) from exc
    except OSError as exc:
        raise OperationError("会话目录不安全") from exc
    try:
        if create:
            try:
                os.mkdir(kind, mode=0o700, dir_fd=root_fd)
            except FileExistsError:
                pass
        try:
            return os.open(kind, flags, dir_fd=root_fd)
        except (FileNotFoundError, NotADirectoryError) as exc:
            raise OperationError("会话目录不存在", "not_found", 404) from exc
        except OSError as exc:
            raise OperationError("会话目录不安全") from exc
    finally:
        os.close(root_fd)


def read_file_bytes(workspace_id: str, conversation_id: str, kind: str, name: str) -> bytes:
    work_file(workspace_id, conversation_id, kind, name)
    try:
        directory_fd = _directory_fd(workspace_id, conversation_id, kind, create=False)
        try:
            file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
            try:
                metadata = os.fstat(file_fd)
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_FILE_BYTES:
                    raise OperationError("文件无效或过大")
                with os.fdopen(file_fd, "rb", closefd=False) as file:
                    return file.read(MAX_FILE_BYTES + 1)
            finally:
                os.close(file_fd)
        finally:
            os.close(directory_fd)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise OperationError("文件不存在", "not_found", 404) from exc
    except OSError as exc:
        raise OperationError("文件无法安全读取") from exc


def list_files(workspace_id: str, conversation_id: str) -> list[dict]:
    root = work_root(workspace_id, conversation_id)
    result = []
    for kind in KINDS:
        directory = root / kind
        if directory.is_symlink() or not directory.is_dir():
            continue
        for target in sorted(directory.iterdir()):
            if target.is_file() and not target.is_symlink():
                result.append(
                    {
                        "kind": kind,
                        "name": target.name,
                        "bytes": target.stat().st_size,
                        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                    }
                )
            if len(result) >= 200:
                return result
    return result


def open_work_folder(workspace_id: str, conversation_id: str) -> None:
    if sys.platform != "darwin":
        raise OperationError("只支持 macOS 桌面打开会话目录", "unsupported_platform", 409)
    root = work_root(workspace_id, conversation_id)
    if root.is_symlink():
        raise OperationError("会话目录不安全")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    subprocess.Popen(
        ["/usr/bin/open", str(root)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def write_file(
    workspace_id: str,
    conversation_id: str,
    kind: str,
    name: str,
    content: bytes,
    expected_sha256: str,
) -> dict:
    if kind not in {"scripts", "outputs", "imports"}:
        raise OperationError("文件类别无效")
    if len(content) > MAX_FILE_BYTES:
        raise OperationError("文件超过 50 MiB")
    work_file(workspace_id, conversation_id, kind, name)
    directory_fd = _directory_fd(workspace_id, conversation_id, kind, create=True)
    try:
        try:
            old = read_file_bytes(workspace_id, conversation_id, kind, name)
        except OperationError as exc:
            if exc.code != "not_found":
                raise
            old = None
        if old is None and expected_sha256:
            raise OperationError("文件不存在，版本不匹配", "revision_conflict", 409)
        if old is not None and hashlib.sha256(old).hexdigest() != expected_sha256:
            raise OperationError("文件已更新", "revision_conflict", 409)
        temporary = f".amadeus-{uuid.uuid4().hex}.tmp"
        file_fd = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=directory_fd,
        )
        try:
            with os.fdopen(file_fd, "wb", closefd=False) as file:
                file.write(content)
                file.flush()
                os.fsync(file_fd)
            os.replace(temporary, name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
        finally:
            os.close(file_fd)
            try:
                os.unlink(temporary, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
    finally:
        os.close(directory_fd)
    return {
        "kind": kind,
        "name": name,
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }
