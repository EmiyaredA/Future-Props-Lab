"""Bounded local media inspection and visual summaries; no persistence or account state."""

import asyncio
import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


async def _run(*args: str, timeout: float = 30) -> bytes:
    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
    )
    try:
        async with asyncio.timeout(timeout):
            output, _ = await process.communicate()
        if process.returncode:
            raise ValueError("媒体无法解码")
        return output
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


async def media_duration(source: Path) -> float | None:
    output = await _run(
        "ffprobe",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(source),
    )
    value = json.loads(output).get("format", {}).get("duration")
    duration = float(value) if value is not None else None
    return duration if duration is not None and math.isfinite(duration) and duration >= 0 else None


async def video_cover(source: Path, target: Path, size: int) -> None:
    for position in (1, 0):
        try:
            pixels = await _run(
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-y",
                "-ss",
                str(position),
                "-protocol_whitelist",
                "file,pipe",
                "-i",
                str(source),
                "-frames:v",
                "1",
                "-vf",
                f"scale={size}:{size}:force_original_aspect_ratio=decrease",
                "-c:v",
                "png",
                "-f",
                "image2pipe",
                "pipe:1",
            )
            if pixels:
                await _write(_cover, pixels, target)
                return
        except ValueError:
            pass
    raise ValueError("无法提取视频画面")


def _cover(pixels: bytes, target: Path) -> None:
    with Image.open(io.BytesIO(pixels)) as image:
        image.save(target, format="WEBP", quality=80)


async def _write(writer, *args) -> None:
    task = asyncio.create_task(asyncio.to_thread(writer, *args))
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise


def _waveform(samples: bytes, target: Path, size: int) -> None:
    signal = np.frombuffer(samples, dtype="<i2").astype(np.float32)
    if not signal.size:
        raise ValueError("音频没有可读取的声音")
    height = max(48, size // 3)
    count = max(16, size // 4)
    peaks = np.array(
        [np.max(np.abs(chunk)) for chunk in np.array_split(signal, min(count, signal.size))]
    )
    peaks /= max(float(peaks.max()), 1)
    image = Image.new("RGBA", (size, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for index, peak in enumerate(peaks):
        x = int((index + 0.5) * size / len(peaks))
        half = max(1, int(peak * height * 0.42))
        draw.line((x, height // 2 - half, x, height // 2 + half), fill=(224, 137, 96, 255), width=2)
    image.save(target, format="WEBP", lossless=True)


async def audio_waveform(source: Path, target: Path, size: int) -> None:
    samples = await _run(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        str(source),
        "-t",
        "60",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "4000",
        "-f",
        "s16le",
        "pipe:1",
    )
    await _write(_waveform, samples, target, size)
