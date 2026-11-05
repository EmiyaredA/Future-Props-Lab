"""Canonical allowlist shared by automation and narrowly scoped service calls."""

import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def automation_manifest():
    path = Path(__file__).resolve().parents[1] / (
        "app/console/governance/automation_operations.json"
    )
    return json.loads(path.read_text())
