"""The Video Editor migration chain."""

from fpl_runtime.migrations import Migration

from .versions import v0001

MIGRATIONS = (Migration("0001_video_editor", v0001.SQL),)
