"""Persist account-scoped preference migration receipts."""

SQL = """
CREATE TABLE remote_desktop_import_receipts (
    run_id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(36) NOT NULL,
    receipt JSON NOT NULL,
    PRIMARY KEY (run_id, owner_user_id, batch_id)
);
"""
