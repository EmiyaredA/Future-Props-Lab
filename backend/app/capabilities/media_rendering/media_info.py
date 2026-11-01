"""Read-only container/codec inspection; alpha declarations describe a channel, not quality."""

import asyncio
import json
from pathlib import Path


def _ebml_type(header: bytes) -> bytes:
    position = header.find(b"\x42\x82")  # EBML DocType, followed by a variable-size length.
    if position < 0 or position + 2 >= len(header):
        return b""
    first = header[position + 2]
    if not first:
        return b""
    width = 9 - first.bit_length()
    end = position + 2 + width
    size = int.from_bytes(header[position + 2 : end], "big") & ((1 << (width * 7)) - 1)
    return header[end : end + size]


def video_info(data: dict, header: bytes) -> dict:
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    container = data.get("format", {}).get("format_name", "")
    if "matroska" in container:
        container = {b"webm": "WebM", b"matroska": "Matroska"}.get(
            _ebml_type(header), "Matroska / WebM"
        )
    elif "mov" in container:
        brand = data.get("format", {}).get("tags", {}).get("major_brand", "")
        container = "MOV" if brand.strip() == "qt" else "MP4"
    pixel = video.get("pix_fmt")
    tags = {k.lower(): str(v) for k, v in video.get("tags", {}).items()}
    alpha = "unknown"
    if tags.get("alpha_mode") == "1" or (
        pixel and pixel.startswith(("yuva", "gbrap", "rgba", "bgra", "argb", "abgr", "ya8", "ya16"))
    ):
        alpha = "present"
    elif pixel and pixel.startswith(("yuv", "yuvj", "gbrp", "rgb", "bgr", "gray", "nv12", "p010")):
        alpha = "absent"
    return {
        "container": container or None,
        "codec": video.get("codec_name"),
        "pixel_format": pixel,
        "alpha_channel": alpha,
    }


async def inspect_video_info(path: Path) -> dict:
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

        def header():
            with path.open("rb") as source:
                return source.read(512)

        return video_info(json.loads(stdout), await asyncio.to_thread(header))
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
