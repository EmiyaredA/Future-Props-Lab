"""Explicit Remote storage schema."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_remote_desktop_preferences", SQL),)
