"""Encode and verify a selected source range with the published segment presets."""

import subprocess
from pathlib import Path
from threading import Event

from .render_engine import RenderCancelled
from .speed import audio_speed_filters

SEGMENT_QUALITY = {
    "high": ("slow", "18", "256k"),
    "balanced": ("medium", "23", "192k"),
    "small": ("veryfast", "28", "128k"),
}


def _dimensions(probe: dict, resolution: str) -> tuple[int, int] | None:
    if resolution == "source":
        return None
    stream = next(
        (item for item in probe.get("streams", []) if item.get("codec_type") == "video"),
        {},
    )
    portrait = int(stream.get("height") or 0) > int(stream.get("width") or 0)
    short, long = (720, 1280) if resolution == "720p" else (1080, 1920)
    return (short, long) if portrait else (long, short)


def encode_segment(
    source: Path,
    output: Path,
    *,
    source_in_us: int,
    duration_us: int,
    resolution: str,
    fps: str | int,
    quality: str,
    audio_mode: str,
    probe: dict,
    playback_rate: float = 1,
    cancel_event: Event | None = None,
) -> None:
    preset, crf, audio_bitrate = SEGMENT_QUALITY[quality]
    args = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{source_in_us / 1_000_000:.6f}",
        "-t",
        f"{duration_us * playback_rate / 1_000_000:.6f}",
        "-i",
        str(source),
        "-t",
        f"{duration_us / 1_000_000:.6f}",
        "-map",
        "0:v:0",
    ]
    filters: list[str] = [f"setpts=(PTS-STARTPTS)/{playback_rate:.8g}"]
    dimensions = _dimensions(probe, resolution)
    if dimensions:
        width, height = dimensions
        filters.append(
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
        )
    if fps != "source":
        filters.append(f"fps={int(fps)}")
    if filters:
        args.extend(["-vf", ",".join(filters)])
    args.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            preset,
            "-crf",
            crf,
            "-pix_fmt",
            "yuv420p",
        ]
    )
    if audio_mode == "keep":
        args.extend(["-map", "0:a?", "-c:a", "aac", "-b:a", audio_bitrate])
        speed_filters = audio_speed_filters(playback_rate)
        if speed_filters:
            args.extend(["-af", ",".join(speed_filters)])
    else:
        args.append("-an")
    args.extend(["-movflags", "+faststart", "-y", str(output)])
    try:
        process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("缺少媒体处理程序：ffmpeg") from exc
    while True:
        try:
            _stdout, stderr = process.communicate(timeout=0.2)
            break
        except subprocess.TimeoutExpired:
            if not cancel_event or not cancel_event.is_set():
                continue
            process.terminate()
            try:
                process.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
            raise RenderCancelled() from None
    if process.returncode:
        raise RuntimeError((stderr or "媒体处理失败")[-4000:])


def validate_segment_output(output_probe: dict, source_probe: dict, config: dict) -> None:
    video = next(
        (
            stream
            for stream in output_probe.get("streams", [])
            if stream.get("codec_type") == "video"
        ),
        None,
    )
    if not video or video.get("codec_name") != "h264":
        raise RuntimeError("分段视频编码规格校验失败")
    if video.get("pix_fmt") != "yuv420p":
        raise RuntimeError("分段视频像素格式校验失败")
    if config["audioMode"] != "keep":
        return
    audio = next(
        (
            stream
            for stream in output_probe.get("streams", [])
            if stream.get("codec_type") == "audio"
        ),
        None,
    )
    source_has_audio = any(
        stream.get("codec_type") == "audio" for stream in source_probe.get("streams", [])
    )
    if source_has_audio and (not audio or audio.get("codec_name") != "aac"):
        raise RuntimeError("分段视频音轨规格校验失败")
