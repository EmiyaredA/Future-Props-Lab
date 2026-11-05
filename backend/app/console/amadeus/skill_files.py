"""Read regular UTF-8 files from the exact Skill version pinned to a conversation."""

import os
import re
import stat
from pathlib import Path

from app.console.amadeus import files
from app.runtime.operation_receipts import OperationError
from fpl_runtime.amadeus_skills import ID, VERSION

MAX_SKILL_FILE_BYTES = 1024 * 1024


def skill_root(owner_user_id, conversation_id, skill_id, *, files_root=None):
    if re.fullmatch(ID, skill_id) is None:
        raise OperationError("Skill ID 无效", "invalid_path", 422)
    root = files.work_root(owner_user_id, conversation_id, files_root=files_root)
    directory = root / "skills" / skill_id
    if directory.parent.is_symlink() or directory.is_symlink():
        raise OperationError("会话 Skill 目录不安全", "invalid_path", 422)
    return directory


def skill_path_parts(relative_path):
    parts = relative_path.split("/")
    if (
        "\\" in relative_path
        or "\x00" in relative_path
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise OperationError("Skill 文件路径无效", "invalid_path", 422)
    return parts


def read_skill_file(
    owner_user_id: str,
    conversation_id: str,
    skill_id: str,
    version: str,
    relative_path: str,
    *,
    files_root: Path | None = None,
) -> dict[str, str | int]:
    if re.fullmatch(VERSION, version) is None:
        raise OperationError("Skill 版本无效", "invalid_path", 422)
    parts = skill_path_parts(relative_path)
    path = skill_root(owner_user_id, conversation_id, skill_id, files_root=files_root)
    try:
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        directory = os.open(path, flags)
        try:
            for part in (version, *parts[:-1]):
                child = os.open(part, flags, dir_fd=directory)
                os.close(directory)
                directory = child
            file = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        finally:
            os.close(directory)
        with os.fdopen(file, "rb") as handle:
            if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                raise OperationError("Skill 文件不存在", "not_found", 404)
            data = handle.read(MAX_SKILL_FILE_BYTES + 1)
        if len(data) > MAX_SKILL_FILE_BYTES:
            raise OperationError("Skill 文件超过 1 MiB", "file_too_large", 422)
        content = data.decode("utf-8")
    except FileNotFoundError as exc:
        raise OperationError("Skill 文件不存在", "not_found", 404) from exc
    except UnicodeDecodeError as exc:
        raise OperationError("Skill 文件不是 UTF-8 文本", "unsupported_file", 422) from exc
    except OSError as exc:
        raise OperationError("Skill 文件路径不安全", "invalid_path", 422) from exc
    return {"path": relative_path, "bytes": len(data), "content": content}
