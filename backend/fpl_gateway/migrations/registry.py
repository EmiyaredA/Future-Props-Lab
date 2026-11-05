"""Gateway's explicit, ordered schema registry."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_gateway", SQL),)
