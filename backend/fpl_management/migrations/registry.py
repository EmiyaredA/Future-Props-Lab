"""Append-only management-owned schema sequence."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_management", SQL),)
