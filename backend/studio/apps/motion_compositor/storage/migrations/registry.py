"""Motion's explicit schema upgrades."""

from studio.apps.motion_compositor.storage.migrations.versions import (
    v0001,
    v0002,
    v0003,
    v0004,
    v0005,
)
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_motion", v0001.SQL),
    Migration("0002_motion_reference_mutations", v0002.SQL),
    Migration("0003_motion_import_batches", v0003.SQL),
    Migration("0004_motion_exports", v0004.SQL),
    Migration("0005_motion_migration_receipts", v0005.SQL),
)
