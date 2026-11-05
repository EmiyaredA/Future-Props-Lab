"""Remember verified target cancellations permanently for each installation."""

SQL = """
CREATE TABLE creative_install_cancellations (
  operation_id VARCHAR(36) PRIMARY KEY
    REFERENCES creative_install_operations(operation_id) ON DELETE RESTRICT,
  fingerprint VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""
