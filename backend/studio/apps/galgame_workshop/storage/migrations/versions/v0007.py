"""Keep the Galgame snapshot publication decision across process restarts."""

SQL = """
CREATE TABLE galgame_snapshot_import_batches (
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(32) NOT NULL,
    source_sha256 VARCHAR(64) NOT NULL,
    manifest_sha256 VARCHAR(64),
    result JSON,
    state VARCHAR(16) NOT NULL
        CHECK(state IN ('staging', 'commit', 'published', 'abort', 'discarded')),
    updated_at DATETIME NOT NULL,
    PRIMARY KEY(owner_user_id, batch_id)
);
"""
