"""Exercise padding removal on synthetic ScreenCaptureKit-style pixel buffers."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.skipif(
    sys.platform != "darwin" or not shutil.which("swiftc"), reason="macOS Swift required"
)
def test_window_padding_is_removed_without_shifting_input_geometry(tmp_path):
    root = Path(__file__).resolve().parents[2]
    binary = tmp_path / "window-frame-contract"
    compile_result = subprocess.run(
        [
            "swiftc",
            "-swift-version",
            "6",
            "-module-cache-path",
            str(tmp_path / "swift-cache"),
            str(root / "backend/studio/host/remote_apps/native/WindowFrameCrop.swift"),
            str(root / "tests/fixtures/remote_window_frame.swift"),
            "-o",
            str(binary),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert compile_result.returncode == 0, compile_result.stderr
    result = subprocess.run([binary], capture_output=True, text=True, timeout=15)
    if result.returncode == 77:
        pytest.skip("macOS IOSurface service unavailable")
    assert result.returncode == 0, result.stderr
