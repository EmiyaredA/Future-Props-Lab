"""Explicit schema registration for the Director owner."""

from studio.apps.director_desk.storage.migrations.versions.v0001 import SQL as INITIAL
from studio.apps.director_desk.storage.migrations.versions.v0002 import SQL as IMPORT_RECEIPTS
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_director", INITIAL),
    Migration("0002_director_import_receipts", IMPORT_RECEIPTS),
)
