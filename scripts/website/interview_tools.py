"""Independent, credential-free interview document MCP entrypoint."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.apps.interview_assistant.process_watchdog import supervise
from app.apps.interview_assistant.task_tools import main

if __name__ == "__main__":
    if sys.argv[1:2] == ["--run-codex"]:
        raise SystemExit(supervise(int(sys.argv[2]), sys.argv[3:]))
    else:
        main()
