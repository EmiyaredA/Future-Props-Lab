"""Upgrade document version markers while preserving content and revisions."""

MIGRATION_ID = "0045_thought_attachments"
SQL = "UPDATE thought_notes SET schema_version = 2 WHERE schema_version = 1;"
