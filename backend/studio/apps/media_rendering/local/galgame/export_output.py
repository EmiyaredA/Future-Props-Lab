"""Verify the published Galgame MP4 format and exact route duration."""

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from studio.apps.media_rendering.local.galgame.timing import PRESETS


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", value).strip(" .-")
    return (cleaned or "galgame-export")[:180]


def _probe_video(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        timeout=120,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def verify_galgame_video(path: Path, preset: str, total_ms: int) -> tuple[int, int, int]:
    probe = _probe_video(path)
    streams = probe.get("streams", [])
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
    width, height, expected_fps = PRESETS[preset]
    if video is None or video.get("codec_name") != "h264":
        raise RuntimeError("导出结果缺少 H.264 视频轨")
    if int(video.get("width", 0)) != width or int(video.get("height", 0)) != height:
        raise RuntimeError("导出结果分辨率不符合预设")
    if video.get("pix_fmt") != "yuv420p":
        raise RuntimeError("导出结果不是兼容性要求的 yuv420p 视频")
    numerator, _, denominator = str(video.get("avg_frame_rate", "0/1")).partition("/")
    actual_fps = float(numerator or 0) / max(1.0, float(denominator or 1))
    if abs(actual_fps - expected_fps) > 0.05:
        raise RuntimeError(f"导出帧率不稳定，请改用 {width}×{height} / 30fps")
    if audio is None or audio.get("codec_name") != "aac":
        raise RuntimeError("导出结果缺少 AAC 音频轨")
    actual_duration_ms = round(float(probe["format"]["duration"]) * 1000)
    frame_ms = 1000 / expected_fps
    if abs(actual_duration_ms - total_ms) > frame_ms + 2:
        raise RuntimeError("导出结果时长与所选路线不一致")
    return width, height, actual_duration_ms
