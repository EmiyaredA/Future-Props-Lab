"""Filesystem traversal primitives for explicitly scoped project directories."""

import os
from contextlib import ExitStack, contextmanager
from pathlib import Path

PRIVATE_NAMES = frozenset(
    {
        "config.toml",
        "credentials",
        "credentials.json",
        "secrets",
        "secrets.toml",
        "secrets.json",
        "node_modules",
        "accounts",
        "profiles",
        "__pycache__",
    }
)
PRIVATE_SUFFIXES = (".pem", ".key", ".sqlite", ".sqlite3", ".db", ".p12")


def visible(name: str) -> bool:
    return bool(name) and not (
        name.startswith(".")
        or name.casefold() in PRIVATE_NAMES
        or name.casefold().endswith(PRIVATE_SUFFIXES)
    )


@contextmanager
def directory_fd(root, parts=(), *, expected_root=None):
    # Open each component relative to its parent so a replaced link is never followed.
    with ExitStack() as stack:
        parent = None

        def descend(part, parent):
            fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            stack.callback(os.close, fd)
            return fd

        for part in Path(root).parts:
            parent = descend(part, parent)
        if expected_root is not None and directory_identity(parent) != expected_root:
            raise ValueError("项目目录已变更")
        for part in parts:
            parent = descend(part, parent)
        yield parent


def directory_identity(fd):
    info = os.fstat(fd)
    return info.st_dev, info.st_ino
