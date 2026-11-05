"""Calculate the positions of a Visual review's requested video interval."""

from .project_access import AcceptanceError


def positions(duration_ms, start=0, end=None):
    end = min(duration_ms - 1, end if end is not None else duration_ms - 1)
    if not 0 <= start <= end:
        raise AcceptanceError("取样区间无效")
    return sorted({round(start + (end - start) * index / 11) for index in range(12)})
