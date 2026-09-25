from __future__ import annotations

import subprocess
import threading
from pathlib import Path

import pytest

from app.capabilities.media_rendering.contracts import RenderCaptureFrame
from app.capabilities.media_rendering.render_engine import (
    RENDER_PRESETS,
    _VideoDecoder,
    render_document,
)
from app.capabilities.media_rendering.timeline_document import parse_timeline_document


@pytest.fixture
def clock_video(tmp_path: Path) -> Path:
    """Long-GOP H.264 with B-frames; brightness encodes source time in seconds."""
    path = tmp_path / "clock.mp4"
    frames = b"".join(bytes([16 + frame // 3]) * (16 * 16 * 3) for frame in range(600))
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            "16x16",
            "-r",
            "30",
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "libx264",
            "-g",
            "60",
            "-bf",
            "3",
            "-sc_threshold",
            "0",
            "-pix_fmt",
            "yuv420p",
            "-y",
            str(path),
        ],
        input=frames,
        check=True,
        capture_output=True,
        timeout=30,
    )
    return path


@pytest.mark.parametrize("source_us", [1_500_000, 12_300_000])
@pytest.mark.parametrize("rate", [1, 1.5])
def test_pipe_decoder_seeks_to_source_time_with_b_frames(clock_video, source_us, rate):
    decoder = _VideoDecoder(clock_video, source_us, 30, (16, 16), threading.Event(), rate)
    try:
        for frame in range(6):
            image = decoder.next()
            assert image is not None
            expected = 16 + 10 * (source_us / 1_000_000 + frame * rate / 30)
            assert abs(image.getpixel((8, 8))[0] - expected) <= 3
    finally:
        decoder.close()


@pytest.mark.parametrize("fps", [30, 60])
def test_encoded_export_does_not_rewind_at_second_transition(
    clock_video, tmp_path, monkeypatch, fps
):
    clips = [
        {
            "id": name,
            "name": name,
            "trackId": "v",
            "kind": "video",
            "assetId": "clock",
            "timelineStartUs": index * 4_000_000,
            "durationUs": 4_000_000,
            "sourceInUs": 12_000_000,
            "playbackRate": 1.25,
            "transform": {"x": 8, "y": 8},
        }
        for index, name in enumerate(["a", "b", "c"])
    ]
    document = parse_timeline_document(
        {
            "tracks": [{"id": "v", "name": "V", "order": 0, "kind": "visual", "clips": clips}],
            "transitions": [
                {
                    "id": "ab",
                    "kind": "crossfade",
                    "durationUs": 2_000_000,
                    "placement": "between",
                    "fromClipId": "a",
                    "toClipId": "b",
                },
                {
                    "id": "bc",
                    "kind": "crossfade",
                    "durationUs": 4_000_000,
                    "placement": "between",
                    "fromClipId": "b",
                    "toClipId": "c",
                },
            ],
        }
    )
    # Small raster keeps the real decoder/encoder/mux regression inexpensive.
    document.settings = document.settings.model_copy(update={"width": 16, "height": 16})
    monkeypatch.setitem(RENDER_PRESETS, "test", (16, 16, fps))
    output = tmp_path / "export.mp4"
    render_document(
        document,
        {"clock": clock_video},
        output,
        preset="test",
        start_us=5_800_000,
        end_us=6_200_000,
        cancel=threading.Event(),
        progress=lambda _: None,
        capture_frame=RenderCaptureFrame(width=16, height=16),
    )
    decoded = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(output),
            "-map",
            "0:v:0",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=30,
    ).stdout
    frame_size = 16 * 16 * 3
    assert len(decoded) == round(0.4 * fps) * frame_size
    boundary = round(0.2 * fps)
    before = decoded[(boundary - 1) * frame_size]
    after = decoded[boundary * frame_size]
    # At 6s the new blend has zero progress: B must continue at local 3s,
    # source 15.75s. Previously it rewound to local 2s (source 14.5s).
    assert after >= before - 3
    assert abs(after - (16 + 15.75 * 10)) <= 3
