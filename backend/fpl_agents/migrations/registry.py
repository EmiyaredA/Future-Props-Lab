"""Workbench schema sequence, independent of legacy migrations."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_agents", SQL),)
