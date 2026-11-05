"""Explicit schema registration for the Director owner."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL as INITIAL
from .versions.v0002 import SQL as IMPORT_RECEIPTS

MIGRATIONS = (
    Migration("0001_director", INITIAL),
    Migration("0002_director_import_receipts", IMPORT_RECEIPTS),
)
