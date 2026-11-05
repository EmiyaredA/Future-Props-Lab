"""Pure timeline bounds and the source files required by a single frame."""

from .timeline_document import VideoEditorTimelineDocument


def timeline_duration_us(document: VideoEditorTimelineDocument) -> int:
    return max(
        (
            clip.timeline_start_us + clip.duration_us
            for track in document.tracks
            for clip in track.clips
        ),
        default=0,
    )


def visual_gaps(document: VideoEditorTimelineDocument) -> list[tuple[int, int]]:
    end = timeline_duration_us(document)
    intervals = sorted(
        (
            clip.timeline_start_us,
            clip.timeline_start_us + clip.duration_us,
        )
        for track in document.tracks
        if track.kind in {"visual", "mixed"} and not track.hidden
        for clip in track.clips
    )
    gaps: list[tuple[int, int]] = []
    cursor = 0
    for start, stop in intervals:
        if start > cursor:
            gaps.append((cursor, start))
        cursor = max(cursor, stop)
    if cursor < end:
        gaps.append((cursor, end))
    return gaps


def visible_tracks(document):
    return sorted(
        (
            track
            for track in document.tracks
            if track.kind in {"visual", "mixed"} and not track.hidden
        ),
        key=lambda track: track.order,
        reverse=True,
    )


def track_frame_sources(track, transitions, time_us):
    clips = sorted(track.clips, key=lambda clip: clip.timeline_start_us)
    by_id = {clip.id: clip for clip in clips}
    seams = [
        item
        for item in transitions
        if item.placement == "between" and item.from_clip_id in by_id and item.to_clip_id in by_id
    ]
    active = [
        item
        for item in seams
        if by_id[item.to_clip_id].timeline_start_us - max(1, item.duration_us // 2)
        <= time_us
        < by_id[item.to_clip_id].timeline_start_us + max(1, item.duration_us // 2)
    ]
    return clips, seams, active


def frame_asset_ids(document, time_us):
    assets = set()
    for track in visible_tracks(document):
        clips, _, transitions = track_frame_sources(track, document.transitions, time_us)
        involved = {
            identity for seam in transitions for identity in (seam.from_clip_id, seam.to_clip_id)
        }
        for clip in clips:
            if clip.id in involved or (
                clip.timeline_start_us <= time_us < clip.timeline_start_us + clip.duration_us
            ):
                if clip.kind in {"video", "image"} and clip.asset_id:
                    assets.add(clip.asset_id)
                if clip.kind == "text" and clip.font_asset_id:
                    assets.add(clip.font_asset_id)
    return assets
