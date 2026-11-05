from __future__ import annotations

import math
import subprocess
import threading
from array import array
from pathlib import Path

import pytest

from app.capabilities.media_rendering.contracts import RenderCaptureFrame
from app.capabilities.media_rendering.render_engine import (
    RENDER_PRESETS,
    _VideoDecoder,
    render_document,
)
from studio.contracts.video_editor.timeline_document import parse_timeline_document


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


def _tone_magnitude(samples: array[float], center_s: float, frequency: float) -> float:
    sample_rate = 48_000
    half_window = 2_400
    center = round(center_s * sample_rate)
    window = samples[center - half_window : center + half_window]
    real = sum(
        value * math.cos(2 * math.pi * frequency * index / sample_rate)
        for index, value in enumerate(window)
    )
    imaginary = sum(
        value * math.sin(2 * math.pi * frequency * index / sample_rate)
        for index, value in enumerate(window)
    )
    return math.hypot(real, imaginary) / max(1, len(window))


def test_audio_overlap_crossfade_is_present_in_export(tmp_path, monkeypatch):
    first = tmp_path / "first.wav"
    second = tmp_path / "second.wav"
    for path, frequency, duration in ((first, 440, 3), (second, 880, 1)):
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"sine=frequency={frequency}:sample_rate=48000:duration={duration}",
                "-c:a",
                "pcm_s16le",
                "-y",
                str(path),
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
    document = parse_timeline_document(
        {
            "settings": {"width": 1920, "height": 1080, "fps": 30},
            "tracks": [
                {
                    "id": "a",
                    "name": "A",
                    "order": 0,
                    "kind": "audio",
                    "clips": [
                        {
                            "id": "first",
                            "name": "first",
                            "trackId": "a",
                            "kind": "audio",
                            "assetId": "first-asset",
                            "timelineStartUs": 0,
                            "durationUs": 3_000_000,
                            "volume": 1,
                        },
                        {
                            "id": "second",
                            "name": "second",
                            "trackId": "a",
                            "kind": "audio",
                            "assetId": "second-asset",
                            "timelineStartUs": 1_000_000,
                            "durationUs": 1_000_000,
                            "volume": 1,
                        },
                    ],
                }
            ],
            "transitions": [
                {
                    "id": "audio-seam",
                    "kind": "audio-crossfade",
                    "durationUs": 1_000_000,
                    "placement": "between",
                    "fromClipId": "first",
                    "toClipId": "second",
                    "easing": "ease-in",
                }
            ],
        }
    )
    document.settings = document.settings.model_copy(update={"width": 16, "height": 16})
    monkeypatch.setitem(RENDER_PRESETS, "audio-test", (16, 16, 30))
    output = tmp_path / "audio-crossfade.mp4"
    render_document(
        document,
        {"first-asset": first, "second-asset": second},
        output,
        preset="audio-test",
        start_us=0,
        end_us=3_000_000,
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
            "0:a:0",
            "-ac",
            "1",
            "-ar",
            "48000",
            "-f",
            "f32le",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=30,
    ).stdout
    samples = array("f")
    samples.frombytes(decoded)
    early = (
        _tone_magnitude(samples, 1.08, 440),
        _tone_magnitude(samples, 1.08, 880),
    )
    middle = (
        _tone_magnitude(samples, 1.50, 440),
        _tone_magnitude(samples, 1.50, 880),
    )
    late = (
        _tone_magnitude(samples, 1.92, 440),
        _tone_magnitude(samples, 1.92, 880),
    )
    assert early[0] > early[1] * 20
    assert 2.4 < middle[0] / middle[1] < 3.8
    assert late[1] > late[0] * 3
    assert _tone_magnitude(samples, 2.50, 440) > 0.04
