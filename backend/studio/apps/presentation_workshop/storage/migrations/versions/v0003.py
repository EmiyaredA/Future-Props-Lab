"""Store validated archive source decisions until exact Assets settlement."""

SQL = """
CREATE TABLE presentation_import_batches (
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(32) NOT NULL,
    source_sha256 VARCHAR(64) NOT NULL,
    manifest_sha256 VARCHAR(64),
    result JSON,
    state VARCHAR(16) NOT NULL
      CHECK(state IN ('staging', 'commit', 'abort', 'published', 'discarded')),
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, batch_id)
);
CREATE UNIQUE INDEX ix_presentation_import_batches_active
  ON presentation_import_batches (owner_user_id, source_sha256)
  WHERE state IN ('staging', 'commit');
CREATE INDEX ix_presentation_import_batches_delivery
  ON presentation_import_batches (state, updated_at);
"""
