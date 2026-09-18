"""Source-time mapping and pitch-preserving audio speed filters."""

from math import floor

from app.schemas.video_editor import VideoEditorClip


def source_time_us(clip: VideoEditorClip, local_us: int) -> int:
    return clip.source_in_us + floor(local_us * (clip.playback_rate or 1))


def audio_speed_filters(rate: float) -> list[str]:
    filters = []
    while rate < 0.5:
        filters.append("atempo=0.5")
        rate /= 0.5
    while rate > 2:
        filters.append("atempo=2")
        rate /= 2
    if rate != 1:
        filters.append(f"atempo={rate:.8g}")
    return filters
