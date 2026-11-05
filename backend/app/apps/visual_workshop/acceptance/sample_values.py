"""Calculate the positions of a Visual review's requested video interval."""

from app.capabilities.media_rendering.sample_positions import review_positions

from .project_access import AcceptanceError


def positions(duration_ms, start=0, end=None):
    try:
        return review_positions(duration_ms, start, end)
    except ValueError as exc:
        raise AcceptanceError(str(exc)) from exc
