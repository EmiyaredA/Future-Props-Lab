"""Persist installation intent before contacting Integrations."""

SQL = """
CREATE TABLE creative_install_operations (
  operation_id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL,
  root_release_id VARCHAR(36) NOT NULL,
  request_fingerprint VARCHAR(64) NOT NULL,
  batch_fingerprint VARCHAR(64) NOT NULL,
  batch JSON NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed')),
  receipt JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_user_id, root_release_id)
);
CREATE INDEX ix_creative_install_operations_owner_user_id
  ON creative_install_operations(owner_user_id);
"""
