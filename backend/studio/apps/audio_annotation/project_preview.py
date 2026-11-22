"""Reduce saved audio peaks to real, bounded waveform bins for a project card."""

from studio.runtime.project_preview import ProjectPreview, preview_version


def audio_preview(waveform, document, duration_ms):
    channels = waveform.peaks
    peaks = []
    count = max((len(channel) for channel in channels), default=0)
    if count:
        bins = min(96, count)
        for index in range(bins):
            start, end = index * count // bins, (index + 1) * count // bins
            peaks.append(
                max((abs(value) for channel in channels for value in channel[start:end]), default=0)
            )
    text = next((item.get("text", "") for item in document.segments if item.get("text")), "")[:400]
    seconds = duration_ms // 1000
    return ProjectPreview(
        kind="waveform",
        version=preview_version(waveform.revision, document.revision, peaks, text),
        label=f"{seconds // 60}:{seconds % 60:02}",
        text=text,
        peaks=peaks,
    )
