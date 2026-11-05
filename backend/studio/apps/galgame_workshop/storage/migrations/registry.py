"""Explicit Galgame database migrations."""

from studio.apps.galgame_workshop.storage.migrations.versions.v0001 import SQL
from studio.apps.galgame_workshop.storage.migrations.versions.v0002 import SQL as STORY_RETENTION
from studio.apps.galgame_workshop.storage.migrations.versions.v0003 import SQL as STORY_OPERATIONS
from studio.apps.galgame_workshop.storage.migrations.versions.v0004 import SQL as MIGRATION_RECEIPTS
from studio.apps.galgame_workshop.storage.migrations.versions.v0005 import SQL as UPLOAD_INTAKES
from studio.apps.galgame_workshop.storage.migrations.versions.v0006 import (
    SQL as ANNOTATION_AUTHORIZATIONS,
)
from studio.apps.galgame_workshop.storage.migrations.versions.v0007 import (
    SQL as SNAPSHOT_IMPORT_BATCHES,
)
from studio.apps.galgame_workshop.storage.migrations.versions.v0008 import SQL as ASR_DISPATCHES
from studio.apps.galgame_workshop.storage.migrations.versions.v0009 import SQL as VIDEO_DISPATCHES
from studio.apps.galgame_workshop.storage.migrations.versions.v0010 import SQL as HANDOFF_DISPATCHES
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_galgame_owned_projects", SQL),
    Migration("0002_story_reference_mutations", STORY_RETENTION),
    Migration("0003_story_operation_receipts", STORY_OPERATIONS),
    Migration("0004_galgame_migration_receipts", MIGRATION_RECEIPTS),
    Migration("0005_galgame_upload_intakes", UPLOAD_INTAKES),
    Migration("0006_galgame_annotation_authorizations", ANNOTATION_AUTHORIZATIONS),
    Migration("0007_galgame_snapshot_import_batches", SNAPSHOT_IMPORT_BATCHES),
    Migration("0008_galgame_asr_dispatches", ASR_DISPATCHES),
    Migration("0009_galgame_video_dispatches", VIDEO_DISPATCHES),
    Migration("0010_galgame_handoff_dispatches", HANDOFF_DISPATCHES),
)
