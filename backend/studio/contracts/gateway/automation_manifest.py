"""Canonical allowlist shared by automation and narrowly scoped service calls."""

import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def automation_manifest():
    path = Path(__file__).with_name("automation_operations.json")
    return json.loads(path.read_text())
