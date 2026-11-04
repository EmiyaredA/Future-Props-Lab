"""Motion's explicit schema upgrades."""

from fpl_runtime.migrations import Migration

from .versions import v0001, v0002, v0003

MIGRATIONS = (
    Migration("0001_motion", v0001.SQL),
    Migration("0002_motion_reference_mutations", v0002.SQL),
    Migration("0003_motion_import_batches", v0003.SQL),
)
