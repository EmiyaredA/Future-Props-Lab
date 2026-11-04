"""Thought owns an independent, append-only migration sequence."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as RETENTION
from .versions.v0003 import SQL as UPLOADS
from .versions.v0004 import SQL as ARCHIVES
from .versions.v0005 import SQL as COMMUNITY_UPLOADS

MIGRATIONS = (
    Migration("0001_thought_documents", SQL),
    Migration("0002_reference_mutations", RETENTION),
    Migration("0003_upload_intents", UPLOADS),
    Migration("0004_archive_imports", ARCHIVES),
    Migration("0005_community_uploads", COMMUNITY_UPLOADS),
)
