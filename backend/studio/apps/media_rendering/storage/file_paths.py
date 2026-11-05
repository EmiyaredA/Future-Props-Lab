"""Durably seal renderer-owned files before acknowledging their results."""

import os


def sync_directory(directory):
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def sync_files(directory):
    for path in directory.iterdir():
        with path.open("rb") as handle:
            os.fsync(handle.fileno())
    sync_directory(directory)
