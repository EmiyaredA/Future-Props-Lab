"""Append-only management-owned schema sequence."""

from studio.apps.management.storage.migrations.versions.v0001 import SQL
from studio.runtime.database.migrations import Migration

MIGRATIONS = (Migration("0001_management", SQL),)
