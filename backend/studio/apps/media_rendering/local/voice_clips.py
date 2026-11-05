"""Cut and verify an encoded voice clip against its original audio."""

import asyncio
import math
import struct
from pathlib import Path

from studio.runtime.files.digests import sha256_file


async def _run_checked(args: list[str], *, capture: bool = False) -> bytes:
    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE if capture else asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"缺少音频处理程序：{args[0]}") from exc
    try:
        async with asyncio.timeout(120):
            output, errors = await process.communicate()
    except BaseException:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()
        raise
    if process.returncode:
        message = errors.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"音频处理失败：{message[-1000:]}")
    return output or b""


async def _probe_duration_ms(path: Path) -> int:
    output = await _run_checked(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture=True,
    )
    return round(float(output.decode().strip()) * 1000)


async def _audio_envelope(
    path: Path, start_ms: int | None = None, end_ms: int | None = None
) -> list[float]:
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
    if start_ms is not None:
        args.extend(["-ss", f"{start_ms / 1000:.3f}"])
    if end_ms is not None:
        args.extend(["-to", f"{end_ms / 1000:.3f}"])
    args.extend(["-i", str(path), "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"])
    pcm = await _run_checked(args, capture=True)
    values: list[float] = []
    samples = struct.iter_unpack("<h", pcm[: len(pcm) - len(pcm) % 2])
    window: list[float] = []
    for (sample,) in samples:
        window.append(sample / 32768)
        if len(window) == 160:
            values.append(math.sqrt(sum(value * value for value in window) / len(window)))
            window.clear()
    return values


def _envelope_correlation(left: list[float], right: list[float]) -> float:
    best = -1.0
    for lag in range(-5, 6):
        left_start = max(0, lag)
        right_start = max(0, -lag)
        length = min(len(left) - left_start, len(right) - right_start)
        if length < 10:
            continue
        left_values = left[left_start : left_start + length]
        right_values = right[right_start : right_start + length]
        left_mean = sum(left_values) / length
        right_mean = sum(right_values) / length
        numerator = sum(
            (left_value - left_mean) * (right_value - right_mean)
            for left_value, right_value in zip(left_values, right_values, strict=True)
        )
        left_energy = sum((value - left_mean) ** 2 for value in left_values)
        right_energy = sum((value - right_mean) ** 2 for value in right_values)
        denominator = math.sqrt(left_energy * right_energy)
        if denominator > 0:
            best = max(best, numerator / denominator)
    return best


async def cut_verified_voice_clip(
    source_path: Path,
    output_path: Path,
    *,
    start_ms: int,
    end_ms: int,
    max_duration_difference_ms: int,
    min_content_correlation: float,
) -> tuple[int, int, float, str]:
    if start_ms < 0 or end_ms <= start_ms:
        raise ValueError("音频裁切区间无效")
    await _run_checked(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source_path),
            "-vn",
            "-af",
            (f"atrim=start={start_ms / 1000:.3f}:end={end_ms / 1000:.3f},asetpts=PTS-STARTPTS"),
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(output_path),
        ],
    )
    actual_ms = await _probe_duration_ms(output_path)
    difference_ms = abs(actual_ms - (end_ms - start_ms))
    if difference_ms > max_duration_difference_ms:
        raise RuntimeError(f"{output_path.name} 时长误差 {difference_ms}ms")
    source_envelope, clip_envelope = await asyncio.gather(
        _audio_envelope(source_path, start_ms, end_ms),
        _audio_envelope(output_path),
    )
    correlation = _envelope_correlation(source_envelope, clip_envelope)
    if correlation < min_content_correlation:
        raise RuntimeError(f"{output_path.name} 内容相关度过低：{correlation:.4f}")
    checksum = await asyncio.to_thread(sha256_file, output_path)
    return actual_ms, difference_ms, correlation, checksum
