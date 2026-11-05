"""Per-conversation working files; no path can escape its account root."""

from __future__ import annotations

import fcntl
import hashlib
import os
import stat
import uuid
from pathlib import Path

from anyio import AsyncFile
from anyio.to_thread import run_sync

from studio.contracts.asset_library.incoming import IncomingFile
from studio.runtime.database.operation_receipts import OperationError

KINDS = frozenset({"imports", "scripts", "outputs"})
MAX_FILE_BYTES = 50 * 1024 * 1024


def work_root(owner_user_id: str, conversation_id: str, *, files_root: Path) -> Path:
    if Path(conversation_id).name != conversation_id or conversation_id in {"", ".", ".."}:
        raise OperationError("会话 ID 无效")
    if Path(owner_user_id).name != owner_user_id or owner_user_id in {"", ".", ".."}:
        raise OperationError("账号 ID 无效")
    path = files_root.resolve()
    for part in ("accounts", owner_user_id, "amadeus", conversation_id):
        path /= part
        if path.is_symlink():
            raise OperationError("会话目录不安全", "unsafe_path", 409)
    return path


def work_file(
    owner_user_id: str,
    conversation_id: str,
    kind: str,
    name: str,
    *,
    files_root: Path,
) -> Path:
    if (
        kind not in KINDS
        or not name
        or Path(name).name != name
        or name in {".", ".."}
        or "\x00" in name
        or name.startswith(".amadeus-")
    ):
        raise OperationError("文件路径无效")
    root = work_root(owner_user_id, conversation_id, files_root=files_root)
    target = root / kind / name
    if root.is_symlink() or (root / kind).is_symlink() or target.is_symlink():
        raise OperationError("不允许符号链接")
    if not target.resolve().is_relative_to(root.resolve()):
        raise OperationError("文件路径越界")
    return target


def read_file(
    owner_user_id: str, conversation_id: str, kind: str, name: str, *, files_root: Path
) -> Path:
    target = work_file(owner_user_id, conversation_id, kind, name, files_root=files_root)
    if not target.is_file():
        raise OperationError("文件不存在", "not_found", 404)
    return target


def _directory_fd(
    owner_user_id: str,
    conversation_id: str,
    kind: str,
    *,
    create: bool,
    files_root: Path,
) -> int:
    root = work_root(owner_user_id, conversation_id, files_root=files_root)
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


def open_work_file(
    owner_user_id: str,
    conversation_id: str,
    kind: str,
    name: str,
    *,
    files_root: Path,
):
    work_file(owner_user_id, conversation_id, kind, name, files_root=files_root)
    try:
        directory_fd = _directory_fd(
            owner_user_id, conversation_id, kind, create=False, files_root=files_root
        )
        try:
            file_fd = os.open(
                name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd
            )
            try:
                metadata = os.fstat(file_fd)
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_FILE_BYTES:
                    raise OperationError("文件无效或过大")
                return os.fdopen(file_fd, "rb"), metadata.st_size
            except BaseException:
                os.close(file_fd)
                raise
        finally:
            os.close(directory_fd)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise OperationError("文件不存在", "not_found", 404) from exc
    except OSError as exc:
        raise OperationError("文件无法安全读取") from exc


def read_file_bytes(
    owner_user_id: str,
    conversation_id: str,
    kind: str,
    name: str,
    *,
    files_root: Path,
) -> bytes:
    file, _size = open_work_file(owner_user_id, conversation_id, kind, name, files_root=files_root)
    with file:
        return file.read(MAX_FILE_BYTES + 1)


def list_files(owner_user_id: str, conversation_id: str, *, files_root: Path) -> list[dict]:
    root = work_root(owner_user_id, conversation_id, files_root=files_root)
    result = []
    for kind in sorted(KINDS):
        directory = root / kind
        if directory.is_symlink() or not directory.is_dir():
            continue
        for target in sorted(directory.iterdir()):
            if (
                target.is_file()
                and not target.is_symlink()
                and not target.name.startswith(".amadeus-")
            ):
                try:
                    file, size = open_work_file(
                        owner_user_id, conversation_id, kind, target.name, files_root=files_root
                    )
                except OperationError as exc:
                    if exc.code == "not_found":
                        continue
                    raise
                with file:
                    result.append(
                        {
                            "kind": kind,
                            "name": target.name,
                            "bytes": size,
                            "sha256": hashlib.file_digest(file, "sha256").hexdigest(),
                        }
                    )
            if len(result) >= 200:
                return result
    return result


def write_file(
    owner_user_id: str,
    conversation_id: str,
    kind: str,
    name: str,
    content: bytes,
    expected_sha256: str,
    *,
    files_root: Path,
) -> dict:
    if kind not in {"scripts", "outputs", "imports"}:
        raise OperationError("文件类别无效")
    if len(content) > MAX_FILE_BYTES:
        raise OperationError("文件超过 50 MiB")
    work_file(owner_user_id, conversation_id, kind, name, files_root=files_root)
    directory_fd = _directory_fd(
        owner_user_id, conversation_id, kind, create=True, files_root=files_root
    )
    try:
        fcntl.flock(directory_fd, fcntl.LOCK_EX)
        try:
            prior, _size = open_work_file(
                owner_user_id, conversation_id, kind, name, files_root=files_root
            )
        except OperationError as exc:
            if exc.code != "not_found":
                raise
            previous_sha256 = None
        else:
            with prior:
                previous_sha256 = hashlib.file_digest(prior, "sha256").hexdigest()
        if previous_sha256 is None and expected_sha256:
            raise OperationError("文件不存在，版本不匹配", "revision_conflict", 409)
        if previous_sha256 is not None and previous_sha256 != expected_sha256:
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
            os.fsync(directory_fd)
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


def commit_import(directory_fd, temporary, name):
    fcntl.flock(directory_fd, fcntl.LOCK_EX)
    try:
        os.link(
            temporary,
            name,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
            follow_symlinks=False,
        )
        os.fsync(directory_fd)
    except FileExistsError as exc:
        raise OperationError("文件已更新", "revision_conflict", 409) from exc
    finally:
        fcntl.flock(directory_fd, fcntl.LOCK_UN)


async def import_work_file(
    owner_user_id: str, conversation_id: str, incoming: IncomingFile, *, files_root: Path
) -> dict:
    name = incoming.filename or "import"
    kind = "imports"
    work_file(owner_user_id, conversation_id, kind, name, files_root=files_root)
    directory_fd = _directory_fd(
        owner_user_id, conversation_id, kind, create=True, files_root=files_root
    )
    temporary = f".amadeus-{uuid.uuid4().hex}.tmp"
    digest = hashlib.sha256()
    count = 0
    try:
        file_fd = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=directory_fd,
        )
        async with AsyncFile(os.fdopen(file_fd, "wb")) as output:
            while data := await incoming.read(1024 * 1024):
                count += len(data)
                if count > MAX_FILE_BYTES:
                    raise OperationError("文件超过 50 MiB")
                digest.update(data)
                await output.write(data)
            await output.flush()
            await run_sync(os.fsync, output.wrapped.fileno())
        await run_sync(commit_import, directory_fd, temporary, name)
    finally:
        try:
            os.unlink(temporary, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        finally:
            os.close(directory_fd)
    return {"kind": kind, "name": name, "bytes": count, "sha256": digest.hexdigest()}
