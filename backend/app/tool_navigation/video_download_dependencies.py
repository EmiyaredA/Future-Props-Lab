"""Probe the known native video download binaries."""

import shutil
import subprocess

from app.tool_navigation.video_download_contracts import BinaryStatus, VideoDownloadDepsOut


def _probe_binary(name: str, *, version_flag: str = "--version") -> BinaryStatus:
    path = shutil.which(name)
    if not path:
        hint = (
            "macOS: brew install yt-dlp ffmpeg"
            if name == "yt-dlp"
            else "macOS: brew install ffmpeg"
        )
        return BinaryStatus(name=name, ok=False, hint=hint)
    try:
        result = subprocess.run(
            [path, version_flag],
            capture_output=True,
            text=True,
            check=False,
            timeout=8,
        )
    except (OSError, subprocess.TimeoutExpired):
        return BinaryStatus(
            name=name,
            ok=False,
            path=path,
            hint=f"无法执行 {name}，请检查安装",
        )
    version_line = (result.stdout or result.stderr or "").strip().splitlines()
    version = version_line[0].strip() if version_line else None
    ok = result.returncode == 0
    return BinaryStatus(
        name=name,
        ok=ok,
        path=path,
        version=version,
        hint=None if ok else f"{name} 返回异常退出码",
    )


def probe_deps() -> VideoDownloadDepsOut:
    yt_dlp = _probe_binary("yt-dlp")
    ffmpeg = _probe_binary("ffmpeg", version_flag="-version")
    return VideoDownloadDepsOut(ready=yt_dlp.ok and ffmpeg.ok, yt_dlp=yt_dlp, ffmpeg=ffmpeg)
