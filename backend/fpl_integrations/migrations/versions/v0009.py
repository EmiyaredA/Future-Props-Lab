"""Persist final cancellation before Creative may release a publication fence."""

SQL = """
CREATE TABLE integration_creative_install_cancellations (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL,
  operation_id VARCHAR(100) NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_user_id, operation_id)
);
CREATE INDEX ix_integration_creative_install_cancellations_owner_user_id
  ON integration_creative_install_cancellations(owner_user_id);
"""
