"""Shared selection policy for the website reader and release builder."""

import re
import stat
import time
from pathlib import Path

RETIRED_SECONDS = 24 * 60 * 60
RETIRED_LIMIT = 2
BUILD_ID = re.compile(r"[a-f0-9]{64}")


def retired_releases(active: Path, builds: Path):
    """Return the eligible releases and the directories awaiting collection."""
    now = time.time()
    found = []
    for path in builds.glob("*"):
        if path == active or not BUILD_ID.fullmatch(path.name):
            continue
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISDIR(info.st_mode):
            try:
                retired = (builds.parent / "retired" / path.name).stat().st_mtime_ns
            except FileNotFoundError:
                retired = 0
            found.append((retired, path))
    found.sort(reverse=True)
    retained = [path for retired, path in found if now - retired / 1e9 < RETIRED_SECONDS][
        :RETIRED_LIMIT
    ]
    return retained, [path for _, path in found if path not in retained]
