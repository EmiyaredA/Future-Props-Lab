"""Bounded, cancellable conversion of one GIF animation cycle to silent MP4."""

import asyncio
from pathlib import Path


async def gif_to_mp4(source: Path, target: Path, *, max_bytes: int) -> None:
    await _convert(source, target, max_bytes=max_bytes, transparent=False)


async def gif_to_webm(source: Path, target: Path, *, max_bytes: int) -> None:
    await _convert(source, target, max_bytes=max_bytes, transparent=True)


async def _convert(source: Path, target: Path, *, max_bytes: int, transparent: bool) -> None:
    filters = (
        "[0:v]format=rgba,pad=ceil(iw/2)*2:ceil(ih/2)*2:color=black@0,"
        "format=yuva420p,fps=100[video]"
        if transparent
        else "[0:v]format=rgba,split[fg][base];"
        "[base]lutrgb=r=0:g=0:b=0:a=255[bg];"
        "[bg][fg]overlay=shortest=1:format=auto,"
        "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=black,format=yuv420p,fps=100[video]"
    )
    encoding = (
        ["-c:v", "libvpx-vp9", "-lossless", "1", "-auto-alt-ref", "0", "-pix_fmt", "yuva420p"]
        if transparent
        else ["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-movflags", "+faststart"]
    )
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-xerror",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-f",
        "gif",
        "-ignore_loop",
        "1",
        "-max_pixels",
        "16777216",
        "-i",
        str(source),
        "-an",
        "-filter_complex",
        filters,
        "-map",
        "[video]",
        *encoding,
        "-fps_mode",
        "cfr",
        "-enc_time_base",
        "1:100",
        "-fs",
        str(max_bytes + 1),
        str(target),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        async with asyncio.timeout(120):
            if await process.wait() or not target.is_file():
                raise ValueError("GIF 动画无法解码或转换")
        if target.stat().st_size > max_bytes:
            raise OverflowError("GIF 转换后的视频超过上传大小限制")
    except BaseException:
        if process.returncode is None:
            process.kill()
            await process.wait()
        target.unlink(missing_ok=True)
        raise
