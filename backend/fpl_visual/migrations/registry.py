"""Explicit Visual database migrations."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_visual_owned_projects", SQL),)
