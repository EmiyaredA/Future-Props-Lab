from __future__ import annotations

import os
import subprocess
import sys
import threading
import time

import pytest

from app.capabilities.media_rendering.render_engine import (
    RenderCancelled,
    _decoder_request_action,
    _decoder_seek_args,
    _decoder_seek_plan,
    _decoder_video_filter,
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


def test_decoder_request_action_holds_freezes_and_reseeks() -> None:
    frame_us = 33_333
    assert _decoder_request_action(None, 0, frame_us) == ("open", 0)
    assert _decoder_request_action(0, 0, frame_us) == ("hold", 0)
    assert _decoder_request_action(0, frame_us, frame_us) == ("advance", 1)
    # Outgoing seam freeze: same local_us must not keep draining the pipe.
    assert _decoder_request_action(999_999, 999_999, frame_us) == ("hold", 0)
    # Continuity / segment restart behind the pipe cursor must reopen.
    assert _decoder_request_action(1_000_000, 500_000, frame_us) == ("open", 500_000)
    # Jumping forward by half a transition should advance many frames, not ignore time.
    assert _decoder_request_action(0, 500_000, frame_us) == (
        "advance",
        round(500_000 / frame_us),
    )


def test_decoder_seek_args_use_trim_for_fine_position() -> None:
    assert _decoder_seek_args(0) == ["-i"]
    assert _decoder_seek_plan(0) == (0, 0.0)
    # Short seeks: no coarse input -ss; fine position is trim in -vf.
    assert _decoder_seek_args(1_500_000, preroll_us=10_000_000) == ["-i"]
    assert _decoder_seek_plan(1_500_000, preroll_us=10_000_000) == (0, 1.5)
    assert _decoder_video_filter(1_500_000, 30, 1, preroll_us=10_000_000) == (
        "trim=start=1.500000,setpts=(PTS-STARTPTS)/1,fps=30,format=rgba"
    )
    # Long seeks: coarse input -ss then fine trim (not output -ss).
    assert _decoder_seek_args(100_000_000, preroll_us=10_000_000) == [
        "-ss",
        "90.000000",
        "-i",
    ]
    assert _decoder_seek_plan(100_000_000, preroll_us=10_000_000) == (90_000_000, 10.0)
    assert _decoder_video_filter(100_000_000, 30, 1.5, preroll_us=10_000_000) == (
        "trim=start=10.000000,setpts=(PTS-STARTPTS)/1.5,fps=30,format=rgba"
    )
