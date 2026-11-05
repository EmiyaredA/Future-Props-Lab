"""Select the exact timeline clips and source ranges for a segment export."""

from .errors import VideoEditorValidationError
from .schemas import parse_timeline_document


def segment_selection(document, requested):
    timeline = parse_timeline_document(document)
    clips = {
        clip.id: clip for track in timeline.tracks for clip in track.clips if clip.kind == "video"
    }
    selected = []
    for item in requested:
        clip = clips.get(item.clip_id)
        if clip is None or not clip.asset_id:
            raise VideoEditorValidationError(
                f"视频片段 {item.clip_id} 不存在", code="clip_not_found"
            )
        selected.append(
            {
                "clipId": clip.id,
                "name": item.name,
                "sourceInUs": clip.source_in_us,
                "playbackRate": clip.playback_rate or 1,
                "durationUs": clip.duration_us,
                "assetId": clip.asset_id,
                "status": "queued",
                "progress": 0,
            }
        )
    return selected
