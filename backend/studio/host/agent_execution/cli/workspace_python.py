"""Standalone bootstrap copied into the managed runtime; no backend imports."""

import runpy
import sys
from pathlib import Path


def main():
    site = Path(__file__).resolve().parent / "site"
    sys.path.insert(0, str(site))
    args = sys.argv[1:]
    if not args:
        raise SystemExit("Use python SCRIPT, python -c CODE or python -m MODULE")
    if args[0] == "-c":
        sys.argv = ["-c", *args[2:]]
        exec(compile(args[1], "<command>", "exec"), {"__name__": "__main__"})
    elif args[0] == "-m":
        sys.argv = args[1:]
        runpy.run_module(args[1], run_name="__main__", alter_sys=True)
    else:
        sys.argv = args
        sys.path.insert(0, str(Path(args[0]).resolve().parent))
        runpy.run_path(args[0], run_name="__main__")


if __name__ == "__main__":
    main()
