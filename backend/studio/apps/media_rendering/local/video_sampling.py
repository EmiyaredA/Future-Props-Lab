"""Select the source frame whose presentation interval contains a media time."""

from __future__ import annotations

import json
import subprocess
from fractions import Fraction
from functools import lru_cache
from pathlib import Path

# Changes to source sampling must invalidate persisted and browser frame caches.
VIDEO_SAMPLING_VERSION = 2


@lru_cache(maxsize=128)
def _stream_clock(path: str) -> tuple[Fraction, int]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=time_base,start_pts",
            "-of",
            "json",
            path,
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    stream = json.loads(result.stdout)["streams"][0]
    return Fraction(stream["time_base"]), int(stream.get("start_pts") or 0)


def source_frame_time(path: Path, source_us: int) -> Fraction:
    """Return seconds from stream start, retaining the exact source PTS.

    Accurate FFmpeg seeks and trim=start discard the frame already on screen
    at a non-grid time. Probe from the preceding keyframe and select the latest
    PTS at or before the requested time instead. This also handles VFR sources;
    rounding by the average frame rate cannot identify their frame intervals.
    """
    time_base, start_pts = _stream_clock(str(path))
    target = Fraction(max(0, source_us), 1_000_000)
    absolute_target = target + start_pts * time_base
    probe_start = max(start_pts * time_base, absolute_target - 1)
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-select_streams",
            "v:0",
            "-read_intervals",
            f"{float(probe_start):.6f}%{float(absolute_target + 1):.6f}",
            "-show_entries",
            "frame=best_effort_timestamp",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    times = [
        (int(frame["best_effort_timestamp"]) - start_pts) * time_base
        for frame in json.loads(result.stdout).get("frames", [])
        if "best_effort_timestamp" in frame
    ]
    if not times:
        raise ValueError("视频没有可解码的画面帧")
    return max((time for time in times if time <= target), default=min(times))
