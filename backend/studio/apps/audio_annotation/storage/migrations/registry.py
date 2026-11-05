"""Versioned schema for the Annotation owner."""

from studio.apps.audio_annotation.storage.migrations.versions.v0001 import SQL
from studio.apps.audio_annotation.storage.migrations.versions.v0002 import SQL as RECEIPTS
from studio.runtime.database.migrations import Migration

MIGRATIONS = (Migration("0001_annotation", SQL), Migration("0002_import_receipts", RECEIPTS))
