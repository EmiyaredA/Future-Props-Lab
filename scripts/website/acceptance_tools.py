"""Independent media-only acceptance MCP entry point; no application boot."""

import sys
from pathlib import Path

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.apps.visual_workshop.acceptance.execution.task_tools import main  # noqa: E402

if __name__ == "__main__":
    if sys.argv[1:2] == ["--run-agent"]:
        from app.capabilities.agents.cli.watchdog import supervise

        raise SystemExit(supervise(int(sys.argv[2]), sys.argv[3:]))
    main()
