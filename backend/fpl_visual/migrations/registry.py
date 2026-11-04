"""Explicit Visual database migrations."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as CANVAS_RETENTION
from .versions.v0003 import SQL as CANVAS_OPERATIONS
from .versions.v0004 import SQL as SEGMENT_HANDOFFS
from .versions.v0005 import SQL as MIGRATION_RECEIPTS

MIGRATIONS = (
    Migration("0001_visual_owned_projects", SQL),
    Migration("0002_canvas_reference_mutations", CANVAS_RETENTION),
    Migration("0003_canvas_operation_receipts", CANVAS_OPERATIONS),
    Migration("0004_visual_segment_handoffs", SEGMENT_HANDOFFS),
    Migration("0005_visual_migration_receipts", MIGRATION_RECEIPTS),
)
