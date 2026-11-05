"""Explicit Visual database migrations."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as CANVAS_RETENTION
from .versions.v0003 import SQL as CANVAS_OPERATIONS
from .versions.v0004 import SQL as SEGMENT_HANDOFFS
from .versions.v0005 import SQL as MIGRATION_RECEIPTS
from .versions.v0006 import SQL as SNAPSHOT_IMPORTS
from .versions.v0007 import SQL as COMPOSITION_DISPATCH
from .versions.v0008 import SQL as GENERATION_DISPATCH
from .versions.v0009 import SQL as REVIEW_DISPATCH

MIGRATIONS = (
    Migration("0001_visual_owned_projects", SQL),
    Migration("0002_canvas_reference_mutations", CANVAS_RETENTION),
    Migration("0003_canvas_operation_receipts", CANVAS_OPERATIONS),
    Migration("0004_visual_segment_handoffs", SEGMENT_HANDOFFS),
    Migration("0005_visual_migration_receipts", MIGRATION_RECEIPTS),
    Migration("0006_visual_snapshot_imports", SNAPSHOT_IMPORTS),
    Migration("0007_visual_composition_dispatches", COMPOSITION_DISPATCH),
    Migration("0008_visual_generation_dispatches", GENERATION_DISPATCH),
    Migration("0009_visual_review_dispatches", REVIEW_DISPATCH),
)
