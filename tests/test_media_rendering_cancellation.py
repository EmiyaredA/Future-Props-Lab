from __future__ import annotations

import os
import subprocess
import sys
import threading
import time

import pytest

from app.capabilities.media_rendering.render_engine import (
    RenderCancelled,
    _read_exact,
    _terminate_process_group,
    _wait_for_process,
    _write_all,
)


def _cancel_soon(event: threading.Event) -> threading.Timer:
    timer = threading.Timer(0.05, event.set)
    timer.start()
    return timer


def test_decoder_pipe_read_is_interruptible() -> None:
    read_descriptor, write_descriptor = os.pipe()
    cancel = threading.Event()
    timer = _cancel_soon(cancel)
    started = time.monotonic()
    try:
        with os.fdopen(read_descriptor, "rb", buffering=0) as stream:
            with pytest.raises(RenderCancelled):
                _read_exact(stream, 1024, cancel=cancel)
    finally:
        os.close(write_descriptor)
        timer.join()
    assert time.monotonic() - started < 1


def test_encoder_pipe_write_is_interruptible() -> None:
    read_descriptor, write_descriptor = os.pipe()
    cancel = threading.Event()
    timer = _cancel_soon(cancel)
    started = time.monotonic()
    try:
        with os.fdopen(write_descriptor, "wb", buffering=0) as stream:
            with pytest.raises(RenderCancelled):
                _write_all(stream, b"x" * 1_000_000, cancel=cancel)
    finally:
        os.close(read_descriptor)
        timer.join()
    assert time.monotonic() - started < 1


def test_encoder_process_wait_is_interruptible() -> None:
    cancel = threading.Event()
    process = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    timer = _cancel_soon(cancel)
    started = time.monotonic()
    try:
        with pytest.raises(RenderCancelled):
            _wait_for_process(process, cancel=cancel)
        assert process.poll() is not None
    finally:
        _terminate_process_group(process)
        timer.join()
    assert time.monotonic() - started < 3
