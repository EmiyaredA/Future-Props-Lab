"""Persist verified, account-scoped Identity migration receipts."""

SQL = """
CREATE TABLE identity_import_receipts (
    run_id VARCHAR(36) NOT NULL,
    dataset VARCHAR(64) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(36) NOT NULL,
    receipt JSON NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (run_id, dataset, owner_user_id, batch_id)
);
"""
