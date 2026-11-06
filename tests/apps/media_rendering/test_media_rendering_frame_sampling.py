from __future__ import annotations

import subprocess
import threading
from fractions import Fraction

import pytest

from studio.apps.media_rendering.local.frame_renderer import _extract_video_frame
from studio.apps.media_rendering.local.render_engine import _VideoDecoder


@pytest.fixture
def numbered_video(tmp_path):
    path = tmp_path / "numbered.mp4"
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
            "24",
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "libx264",
            "-crf",
            "0",
            "-g",
            "48",
            "-bf",
            "3",
            "-pix_fmt",
            "yuv444p",
            "-y",
            str(path),
        ],
        input=b"".join(bytes([10 + index * 2]) * (16 * 16 * 3) for index in range(120)),
        check=True,
        capture_output=True,
        timeout=30,
    )
    return path


@pytest.mark.parametrize(
    "source_us,index",
    [(0, 0), (4_583_333, 109), (4_591_572, 110), (4_625_000, 111), (4_999_999, 119)],
)
def test_exact_frame_samples_current_source_interval(numbered_video, source_us, index):
    frame = _extract_video_frame(numbered_video, source_us)
    assert abs(frame.getpixel((8, 8))[0] - (10 + index * 2)) <= 1


@pytest.mark.parametrize("fps,rate", [(30, 1), (60, 1), (30, 1.5), (30, 0.5)])
@pytest.mark.parametrize("source_us", [4_591_572, 4_583_333, 4_624_999])
def test_export_decoder_samples_same_intervals_as_exact_frames(
    numbered_video, fps, rate, source_us
):
    decoder = _VideoDecoder(numbered_video, source_us, fps, (16, 16), threading.Event(), rate)
    try:
        for index in range(6):
            image = decoder.next()
            assert image is not None
            expected_index = int((source_us / 1_000_000 + index * rate / fps) * 24)
            assert abs(image.getpixel((8, 8))[0] - (10 + expected_index * 2)) <= 1
    finally:
        decoder.close()


@pytest.fixture(params=[0, 5])
def variable_rate_video(tmp_path, request):
    path = tmp_path / "variable.mp4"
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
            "24",
            "-i",
            "pipe:0",
            "-an",
            "-vf",
            f"setpts=(N+floor(N/2))/(24*TB)+{request.param}/TB",
            "-fps_mode",
            "vfr",
            "-c:v",
            "libx264",
            "-crf",
            "0",
            "-g",
            "24",
            "-pix_fmt",
            "yuv444p",
            "-y",
            str(path),
        ],
        input=b"".join(bytes([20 + index * 20]) * (16 * 16 * 3) for index in range(8)),
        check=True,
        capture_output=True,
        timeout=30,
    )
    return path


def test_exact_and_export_sampling_preserve_vfr_intervals_and_stream_start(variable_rate_video):
    decoder = _VideoDecoder(variable_rate_video, 101_000, 30, (16, 16), threading.Event())
    pts = [Fraction(index + index // 2, 24) for index in range(8)]
    try:
        for index in range(7):
            time = Fraction(101, 1000) + Fraction(index, 30)
            expected_index = max(i for i, timestamp in enumerate(pts) if timestamp <= time)
            exact = _extract_video_frame(variable_rate_video, int(time * 1_000_000))
            image = decoder.next()
            assert image is not None
            assert abs(exact.getpixel((8, 8))[0] - (20 + expected_index * 20)) <= 1
            assert abs(image.getpixel((8, 8))[0] - exact.getpixel((8, 8))[0]) <= 1
    finally:
        decoder.close()


def test_export_can_hold_final_source_frame(numbered_video):
    decoder = _VideoDecoder(numbered_video, 4_999_999, 30, (16, 16), threading.Event())
    try:
        image = decoder.next()
        assert image is not None
        assert abs(image.getpixel((8, 8))[0] - 248) <= 1
    finally:
        decoder.close()
