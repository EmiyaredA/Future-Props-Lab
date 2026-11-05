"""Bind a Galgame handoff to its first admitted archive checksum."""

SQL = """
ALTER TABLE video_import_batches ADD COLUMN handoff_archive_sha256 VARCHAR(64);
CREATE INDEX ix_video_import_batches_handoff_source
    ON video_import_batches(owner_user_id, source_sha256)
    WHERE handoff_archive_sha256 IS NOT NULL;
"""
