"""Deterministic, cancellable PCM extraction shared by server-side media use cases."""

import asyncio
from pathlib import Path


async def extract_wav(source: Path, target: Path, start_ms: int, end_ms: int) -> None:
    if start_ms < 0 or end_ms <= start_ms:
        raise ValueError("Invalid audio range")
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(source),
        "-vn",
        "-af",
        f"atrim=start={start_ms / 1000:.3f}:end={end_ms / 1000:.3f},asetpts=PTS-STARTPTS",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        str(target),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        async with asyncio.timeout(120):
            if await process.wait():
                raise ValueError("Audio extraction failed")
    except BaseException:
        if process.returncode is None:
            process.kill()
            await process.wait()
        target.unlink(missing_ok=True)
        raise
