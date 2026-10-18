"""Local reference preflight, before task admission or any external media upload."""

import asyncio
import json
import math
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from PIL import Image

from app.llm.providers.seedance_parameters import video_capabilities


@dataclass(frozen=True)
class SeedanceReference:
    kind: str
    mime_type: str
    path: Path


def _inspect(reference: SeedanceReference, max_duration: int) -> tuple[int, float]:
    path, kind = reference.path, reference.kind
    if not path.is_file():
        raise ValueError("参考素材文件已不存在")
    size = path.stat().st_size
    limits = {"image": 30, "audio": 15, "video": 200}
    mimes = {
        "image": {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff"},
        "audio": {"audio/mpeg", "audio/wav", "audio/x-wav"},
        "video": {"video/mp4", "video/quicktime"},
    }
    if reference.mime_type not in mimes[kind]:
        raise ValueError("方舟不支持所选参考素材格式")
    if not 0 < size <= limits[kind] * 1024 * 1024:
        label = {"image": "图片", "audio": "音频", "video": "视频"}[kind]
        raise ValueError(f"单个参考{label}不能超过 {limits[kind]} MB 且不能为空")
    duration = 0.0
    if kind == "image":
        with Image.open(path) as image:
            width, height = image.size
            image.verify()
    else:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            check=True,
            timeout=30,
        )
        data = json.loads(result.stdout)
        duration = float(data["format"]["duration"])
        if not math.isfinite(duration) or not 2 <= duration <= max_duration:
            raise ValueError(f"参考视频和音频的单段时长必须为 2–{max_duration} 秒")
        streams = data.get("streams", [])
        if kind == "audio":
            if not any(
                s.get("codec_type") == "audio"
                and s.get("codec_name")
                in {"mp3", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_u8"}
                for s in streams
            ):
                raise ValueError("参考音频必须是有效的 MP3 或 WAV")
            return size, duration
        stream = next(s for s in streams if s.get("codec_type") == "video")
        if stream.get("codec_name") not in {"h264", "hevc"}:
            raise ValueError("参考视频仅支持 H.264 或 H.265 编码")
        width, height = stream["width"], stream["height"]
        fps = float(Fraction(stream["avg_frame_rate"]))
        if not 24 <= fps <= 60 or not 407696 <= width * height <= 8295044:
            raise ValueError("参考视频帧率须为 24–60 FPS，像素数须为 407696–8295044")
    if not (300 <= width <= 6000 and 300 <= height <= 6000 and 0.4 <= width / height <= 2.5):
        raise ValueError("参考图片或视频宽高须为 300–6000 像素，宽高比须为 0.4–2.5")
    return size, duration


async def validate_seedance_references(
    slug: str, payload: dict, references: list[SeedanceReference], upload_url: str
):
    caps = video_capabilities("volcengine_video", slug)
    if any(r.kind == "video" for r in references) and not upload_url:
        raise ValueError("参考视频需要配置 [integrations].temp_media_upload_url 临时上传服务")
    totals = {"audio": 0.0, "video": 0.0}
    inline_bytes = len(payload.get("prompt", "").encode()) + 4096
    for reference in references:
        try:
            size, duration = await asyncio.to_thread(_inspect, reference, caps.duration_max)
        except (
            OSError,
            subprocess.SubprocessError,
            KeyError,
            StopIteration,
            ZeroDivisionError,
        ) as exc:
            raise ValueError("无法读取参考素材，请检查文件内容或 FFprobe 安装") from exc
        if reference.kind != "video":
            inline_bytes += 4 * ((size + 2) // 3) + 256
        if reference.kind in totals:
            totals[reference.kind] += duration
    if any(total > caps.duration_max for total in totals.values()):
        raise ValueError(f"参考视频或音频的累计时长不能超过 {caps.duration_max} 秒")
    if inline_bytes > 64 * 1024 * 1024:
        raise ValueError("参考素材编码后的请求体超过方舟的 64 MB 限制")
