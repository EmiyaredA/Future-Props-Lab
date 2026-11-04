"""Persist each archive source decision atomically with the imported content."""

SQL = """
CREATE TABLE thought_archive_imports (
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(32) NOT NULL,
    request_key VARCHAR(128),
    source_sha256 VARCHAR(64) NOT NULL,
    manifest_sha256 VARCHAR(64),
    state VARCHAR(16) NOT NULL
        CHECK(state IN ('staging', 'retry', 'commit', 'abort', 'published', 'discarded')),
    result JSON,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, batch_id),
    UNIQUE (owner_user_id, request_key)
);
CREATE INDEX ix_thought_archive_imports_pending ON thought_archive_imports(state, updated_at);
CREATE INDEX ix_thought_archive_imports_source_sha256 ON thought_archive_imports(source_sha256);
"""
