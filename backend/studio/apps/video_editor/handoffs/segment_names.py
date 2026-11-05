"""Keep exported segment and ZIP member names portable."""

import re


def segment_filename(name: str) -> str:
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', "_", name).strip(" .")
    # Leave room for the extension and ZIP sequence prefix on UTF-8 filesystems.
    safe = safe.encode("utf-8")[:200].decode("utf-8", errors="ignore") or "片段"
    return f"{safe}.mp4"
