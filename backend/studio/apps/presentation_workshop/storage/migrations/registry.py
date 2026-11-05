"""Versioned schema for the Presentation owner."""

from studio.apps.presentation_workshop.storage.migrations.versions import v0001, v0002, v0003, v0004
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_presentation", v0001.SQL),
    Migration("0002_presentation_examples", v0002.SQL),
    Migration("0003_presentation_import_batches", v0003.SQL),
    Migration("0004_presentation_migration_receipts", v0004.SQL),
)
