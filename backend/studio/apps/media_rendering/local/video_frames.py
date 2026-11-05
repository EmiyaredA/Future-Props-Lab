import asyncio
from pathlib import Path


async def extract_frame(source: Path, target: Path, position_ms: int, max_width: int):
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-ss",
        str(position_ms / 1000),
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        str(source),
        "-frames:v",
        "1",
        "-vf",
        f"scale='min({max_width},iw)':-1",
        str(target),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        async with asyncio.timeout(60):
            code = await process.wait()
            if code or not target.is_file():
                raise ValueError("帧位置超出范围或视频无法解码")
    except BaseException:
        if process.returncode is None:
            process.kill()
            await process.wait()
        target.unlink(missing_ok=True)
        raise
