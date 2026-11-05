"""Canonical digest for the regular files in an extracted Skill tree."""

import hashlib
import os
import stat
from pathlib import Path


def skill_tree_sha256(root: Path, *, max_files: int, max_bytes: int) -> str:
    if type(max_files) is not int or max_files < 1 or type(max_bytes) is not int or max_bytes < 1:
        raise ValueError("Skill 文件限制无效")
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Skill 文件目录无效")
    entries = []
    seen = set()

    def walk_error(error):
        raise error

    for directory, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
        for name in dirs:
            path = Path(directory) / name
            if path.is_symlink():
                raise ValueError("Skill 目录不能包含符号链接")
        for name in files:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            key = relative.casefold()
            if key in seen or "\\" in relative or "\x00" in relative:
                raise ValueError("Skill 文件路径无效")
            seen.add(key)
            entries.append((relative, path))
            if len(entries) > max_files:
                raise ValueError("Skill 文件数量超限")
    if not entries:
        raise ValueError("Skill 文件目录为空")
    result = hashlib.sha256(b"fpl-skill-tree-v1\0")
    total = 0
    for relative, path in sorted(entries, key=lambda item: item[0].encode("utf-8")):
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise ValueError("Skill 只能包含普通文件")
            total += before.st_size
            if total > max_bytes:
                raise ValueError("Skill 文件大小超限")
            content = hashlib.sha256()
            while chunk := source.read(1024 * 1024):
                content.update(chunk)
            after = os.fstat(source.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ino) != (
                after.st_size,
                after.st_mtime_ns,
                after.st_ino,
            ):
                raise ValueError("Skill 文件读取时发生变化")
        name = relative.encode("utf-8")
        result.update(len(name).to_bytes(4, "big"))
        result.update(name)
        result.update(before.st_size.to_bytes(8, "big"))
        result.update(content.digest())
    return result.hexdigest()
