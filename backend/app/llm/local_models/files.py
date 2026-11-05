"""Exact owned paths for fixed model layouts; nested links cannot redirect host operations."""

from pathlib import Path


def owned_path(root, *parts, allow_leaf_symlink=False):
    root = Path(root)
    if root.is_symlink():
        raise ValueError("模型目录不能是符号链接")
    candidate = root.joinpath(*parts)
    try:
        relative = candidate.relative_to(root)
    except ValueError:
        raise ValueError("模型路径越出自有目录") from None
    if any(part in {".", ".."} for part in relative.parts):
        raise ValueError("模型路径包含无效部分")
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink() and (current != candidate or not allow_leaf_symlink):
            raise ValueError("模型路径不能经过符号链接")
    if not candidate.resolve().is_relative_to(root.resolve()):
        raise ValueError("模型路径越出自有目录")
    return candidate
