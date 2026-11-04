"""Explicit Galgame database migrations."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_galgame_owned_projects", SQL),)
