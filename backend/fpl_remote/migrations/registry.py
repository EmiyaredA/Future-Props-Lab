"""Explicit Remote storage schema."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as IMPORT_RECEIPTS

MIGRATIONS = (
    Migration("0001_remote_desktop_preferences", SQL),
    Migration("0002_remote_desktop_import_receipts", IMPORT_RECEIPTS),
)
