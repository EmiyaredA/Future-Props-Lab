"""Frozen CLI entry point, deliberately independent of backend application imports."""

from future_props_lab.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
