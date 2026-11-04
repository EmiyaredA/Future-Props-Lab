"""Validate the rendered movie against its committed preset and timeline duration."""

from pathlib import Path

from .presets import RENDER_PRESETS
from .video_derivatives import probe_media


def _fraction(value: object) -> float:
    text = str(value or "0")
    numerator, separator, denominator = text.partition("/")
    if not separator:
        return float(numerator or 0)
    divisor = float(denominator or 0)
    return float(numerator or 0) / divisor if divisor else 0.0


def verify_video_output(path: Path, preset: str, expected_duration_us: int) -> dict:
    probe = probe_media(path)
    width, height, fps = RENDER_PRESETS[preset]
    video = next(
        (stream for stream in probe.get("streams", []) if stream.get("codec_type") == "video"),
        None,
    )
    audio = next(
        (stream for stream in probe.get("streams", []) if stream.get("codec_type") == "audio"),
        None,
    )
    if not video or not audio:
        raise RuntimeError("成片缺少 H.264 画面或 AAC 音轨")
    if (
        video.get("codec_name") != "h264"
        or audio.get("codec_name") != "aac"
        or video.get("width") != width
        or video.get("height") != height
        or video.get("pix_fmt") != "yuv420p"
        or int(audio.get("sample_rate") or 0) != 48_000
    ):
        raise RuntimeError("成片规格校验失败")
    expected_frames = round(expected_duration_us / 1_000_000 * fps)
    actual_frames = int(video.get("nb_frames") or 0)
    actual_fps = _fraction(video.get("avg_frame_rate"))
    duration_delta_us = abs(int(probe.get("durationUs") or 0) - expected_duration_us)
    if (
        actual_frames != expected_frames
        or abs(actual_fps - fps) > 0.001
        or duration_delta_us > max(round(1_000_000 / fps), 2_000)
    ):
        raise RuntimeError("成片帧数、帧率或时长校验失败")
    return probe


def verify_clip_merge_output(path: Path, preset: str, expected_duration_us: int) -> dict:
    probe = probe_media(path)
    width, height, fps = RENDER_PRESETS[preset]
    video = next((item for item in probe["streams"] if item.get("codec_type") == "video"), {})
    audio = next((item for item in probe["streams"] if item.get("codec_type") == "audio"), {})
    if (
        video.get("codec_name") != "prores"
        or not str(video.get("pix_fmt", "")).startswith("yuva")
        or video.get("width") != width
        or video.get("height") != height
        or abs(_fraction(video.get("avg_frame_rate")) - fps) > 0.001
        or int(video.get("nb_frames") or 0) != (expected_duration_us * fps + 999_999) // 1_000_000
        or abs(int(probe.get("durationUs") or 0) - expected_duration_us) > round(1_000_000 / fps)
        or audio.get("codec_name") != "aac"
        or int(audio.get("sample_rate") or 0) != 48_000
    ):
        raise RuntimeError("合并视频的画幅、帧数、透明通道、时长或音轨校验失败")
    return probe
