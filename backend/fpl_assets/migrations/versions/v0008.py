"""Durable archive staging, isolated from the visible asset library."""

SQL = """
CREATE TABLE asset_presentation_archive_batches (
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(32) NOT NULL,
    source_sha256 VARCHAR(64) NOT NULL,
    manifest_sha256 VARCHAR(64),
    projections JSON,
    state VARCHAR(16) NOT NULL CHECK(state IN ('staging', 'sealed', 'published', 'aborted')),
    created_at DATETIME NOT NULL,
    PRIMARY KEY(owner_user_id, batch_id)
);
CREATE TABLE asset_presentation_archive_files (
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(32) NOT NULL,
    ordinal INTEGER NOT NULL,
    asset_id VARCHAR(36) NOT NULL UNIQUE,
    descriptor_sha256 VARCHAR(64) NOT NULL,
    metadata_snapshot JSON NOT NULL,
    PRIMARY KEY(owner_user_id, batch_id, ordinal),
    FOREIGN KEY(owner_user_id, batch_id)
        REFERENCES asset_presentation_archive_batches(owner_user_id, batch_id) ON DELETE RESTRICT
);
"""
