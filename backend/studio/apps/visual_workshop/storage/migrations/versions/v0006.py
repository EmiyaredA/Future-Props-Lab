"""Persist the exact portable archive decision before publishing a Visual project."""

SQL = """
CREATE TABLE visual_snapshot_import_batches (
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(32) NOT NULL,
    source_sha256 VARCHAR(64) NOT NULL,
    manifest_sha256 VARCHAR(64),
    result JSON,
    state VARCHAR(16) NOT NULL
        CHECK(state IN ('staging', 'commit', 'abort', 'published', 'discarded')),
    updated_at DATETIME NOT NULL,
    PRIMARY KEY(owner_user_id, batch_id)
);
CREATE INDEX ix_visual_snapshot_import_batches_state
    ON visual_snapshot_import_batches(state, updated_at);
"""
