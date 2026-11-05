"""Bounded local media inspection without application-specific persistence."""

import asyncio
import json
from pathlib import Path

from PIL import Image


async def inspect_media(path: Path, kind: str) -> dict:
    if kind == "image":

        def inspect():
            with Image.open(path) as image:
                width, height = image.size
                image.verify()
            return {"width": width, "height": height}

        return await asyncio.to_thread(inspect)
    process = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        async with asyncio.timeout(30):
            stdout, _ = await process.communicate()
        if process.returncode:
            raise ValueError("视频元数据无法读取")
        data = json.loads(stdout)
        video = next(item for item in data["streams"] if item["codec_type"] == "video")
        return {
            "width": int(video["width"]),
            "height": int(video["height"]),
            "duration_ms": round(float(data["format"]["duration"]) * 1000),
            "has_audio": any(item["codec_type"] == "audio" for item in data["streams"]),
        }
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


async def verify_video(path: Path):
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-v",
        "error",
        "-xerror",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        str(path),
        "-map",
        "0:v:0",
        "-f",
        "null",
        "-",
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        async with asyncio.timeout(120):
            if await process.wait():
                raise ValueError("视频解码检查失败")
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
