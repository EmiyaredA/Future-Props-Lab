"""The Video Editor migration chain."""

from fpl_runtime.migrations import Migration

from .versions import v0001, v0002, v0003

MIGRATIONS = (
    Migration("0001_video_editor", v0001.SQL),
    Migration("0002_video_timeline_media", v0002.SQL),
    Migration("0003_video_reference_mutations", v0003.SQL),
)
