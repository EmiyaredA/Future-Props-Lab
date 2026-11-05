"""Explicit Remote storage schema."""

from studio.apps.remote_desktop.storage.migrations.versions.v0001 import SQL
from studio.apps.remote_desktop.storage.migrations.versions.v0002 import SQL as IMPORT_RECEIPTS
from studio.apps.remote_desktop.storage.migrations.versions.v0003 import SQL as SETUP_JOBS
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_remote_desktop_preferences", SQL),
    Migration("0002_remote_desktop_import_receipts", IMPORT_RECEIPTS),
    Migration("0003_remote_setup_jobs", SETUP_JOBS),
)
