"""Credential-agnostic process lifetime guard, also built into interview-tools."""

import os
import signal
import subprocess
import time


def supervise(parent_pid: int, command: list[str]) -> int:
    if not command or os.getppid() != parent_pid:
        return 1
    stopping = False

    def stop(_signal=None, _frame=None):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    child = subprocess.Popen(command)
    deadline = time.monotonic() + 15 * 60
    while child.poll() is None:
        if stopping or os.getppid() != parent_pid or time.monotonic() >= deadline:
            # Keep this supervisor alive through TERM so it can enforce the KILL deadline.
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            os.killpg(os.getpgrp(), signal.SIGTERM)
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(os.getpgrp(), signal.SIGKILL)
            return 1
        time.sleep(0.2)
    # A completed CLI must not leave its material MCP or private app-server behind.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    os.killpg(os.getpgrp(), signal.SIGTERM)
    return child.returncode
