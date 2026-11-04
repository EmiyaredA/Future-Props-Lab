"""Explicit Galgame database migrations."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as STORY_RETENTION
from .versions.v0003 import SQL as STORY_OPERATIONS
from .versions.v0004 import SQL as MIGRATION_RECEIPTS
from .versions.v0005 import SQL as UPLOAD_INTAKES
from .versions.v0006 import SQL as ANNOTATION_AUTHORIZATIONS
from .versions.v0007 import SQL as SNAPSHOT_IMPORT_BATCHES

MIGRATIONS = (
    Migration("0001_galgame_owned_projects", SQL),
    Migration("0002_story_reference_mutations", STORY_RETENTION),
    Migration("0003_story_operation_receipts", STORY_OPERATIONS),
    Migration("0004_galgame_migration_receipts", MIGRATION_RECEIPTS),
    Migration("0005_galgame_upload_intakes", UPLOAD_INTAKES),
    Migration("0006_galgame_annotation_authorizations", ANNOTATION_AUTHORIZATIONS),
    Migration("0007_galgame_snapshot_import_batches", SNAPSHOT_IMPORT_BATCHES),
)
