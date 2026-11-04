"""Motion's explicit schema upgrades."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_motion", SQL),)
