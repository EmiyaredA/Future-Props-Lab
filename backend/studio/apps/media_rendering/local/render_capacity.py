"""Inspect the renderer's actual tools, bundled fonts and owned working volume."""

import shutil
from dataclasses import dataclass
from pathlib import Path

from studio.apps.media_rendering.local.text_layer import FONT_ROOT, load_text_font

GALGAME_FONTS = ("NotoSansSC-Regular.ttf", "NotoSansSC-Medium.ttf")
RENDER_PROGRAMS = ("ffmpeg", "ffprobe")


@dataclass(frozen=True)
class RenderCapacity:
    missing_programs: tuple[str, ...]
    font_issue: str | None
    free_bytes: int


def galgame_font_issue():
    missing = [name for name in GALGAME_FONTS if not (FONT_ROOT / name).is_file()]
    if missing:
        return f"Galgame 导出字体缺失：{', '.join(missing)}"
    try:
        for name in GALGAME_FONTS:
            load_text_font(str(FONT_ROOT / name), 16)
    except (OSError, RuntimeError):
        return "Galgame 导出字体无法加载"
    return None


def galgame_capacity(root: Path):
    try:
        free_bytes = shutil.disk_usage(root).free
    except OSError:
        free_bytes = 0
    return RenderCapacity(
        missing_programs=tuple(
            program for program in RENDER_PROGRAMS if shutil.which(program) is None
        ),
        font_issue=galgame_font_issue(),
        free_bytes=free_bytes,
    )
