"""Translate visible editor font sizes to native PowerPoint text sizes."""

# PowerPoint renders runs with a nonzero DrawingML baseline at 65% of sz.
# The editor's run.size is already the visible size, including for scripts.
SCRIPT_FONT_SCALE = 0.65


def native_font_size(size: float, script: str) -> float:
    return size / SCRIPT_FONT_SCALE if script in {"sup", "sub"} else size


def visible_font_size(size: float, script: str) -> float:
    return size * SCRIPT_FONT_SCALE if script in {"sup", "sub"} else size
