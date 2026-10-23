"""Frozen CLI entry point, deliberately independent of backend application imports."""

import sys
from pathlib import Path

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sdk/python/src"))

from future_props_lab.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
