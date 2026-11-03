"""Creative owns a separately registered, explicit migration sequence."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_creative_catalog", SQL),)
