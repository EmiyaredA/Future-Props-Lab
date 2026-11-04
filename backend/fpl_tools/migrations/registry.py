"""Explicit Tools schema migration registry."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_tools_navigation", SQL),)
