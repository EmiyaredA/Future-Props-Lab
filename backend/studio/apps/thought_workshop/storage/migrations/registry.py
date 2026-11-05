"""Thought owns an independent, append-only migration sequence."""

from studio.apps.thought_workshop.storage.migrations.versions.v0001 import SQL
from studio.apps.thought_workshop.storage.migrations.versions.v0002 import SQL as RETENTION
from studio.apps.thought_workshop.storage.migrations.versions.v0003 import SQL as UPLOADS
from studio.apps.thought_workshop.storage.migrations.versions.v0004 import SQL as ARCHIVES
from studio.apps.thought_workshop.storage.migrations.versions.v0005 import SQL as COMMUNITY_UPLOADS
from studio.apps.thought_workshop.storage.migrations.versions.v0006 import SQL as IMPORT_RECEIPTS
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_thought_documents", SQL),
    Migration("0002_reference_mutations", RETENTION),
    Migration("0003_upload_intents", UPLOADS),
    Migration("0004_archive_imports", ARCHIVES),
    Migration("0005_community_uploads", COMMUNITY_UPLOADS),
    Migration("0006_import_receipts", IMPORT_RECEIPTS),
)
