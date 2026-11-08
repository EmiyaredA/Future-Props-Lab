"""Check the macOS event representation without sending input to any application."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.skipif(
    sys.platform != "darwin" or not shutil.which("swiftc"), reason="macOS Swift required"
)
def test_process_targeted_mouse_retains_window_and_local_coordinates(tmp_path):
    root = Path(__file__).resolve().parents[2]
    binary = tmp_path / "window-mouse-contract"
    subprocess.run(
        [
            "swiftc",
            "-swift-version",
            "6",
            "-module-cache-path",
            str(tmp_path / "swift-cache"),
            str(root / "backend/studio/host/remote_apps/native/WindowMouseEvent.swift"),
            str(root / "tests/fixtures/remote_window_mouse.swift"),
            "-o",
            str(binary),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    )
    result = subprocess.run([binary], capture_output=True, text=True, timeout=15)
    if result.returncode == 77:
        pytest.skip("A macOS login session is required")
    assert result.returncode == 0, result.stderr
    assert "24 process-targeted mouse event contracts passed" in result.stdout
