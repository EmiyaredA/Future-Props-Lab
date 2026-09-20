"""Minimal Python entrypoint for sandboxed Amadeus scripts."""

import sys

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: fpl-script-runner <script-name>")
    source = sys.stdin.buffer.read(100_001)
    if len(source) > 100_000:
        raise SystemExit("script too large")
    namespace = {"__name__": "__main__", "__file__": sys.argv[1]}
    exec(compile(source, sys.argv[1], "exec"), namespace)
