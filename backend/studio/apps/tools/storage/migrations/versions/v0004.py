"""Persist resumable imports of account-scoped navigation state."""

SQL = """
CREATE TABLE tools_navigation_import_receipts (
    run_id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(36) NOT NULL,
    receipt JSON NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (run_id, owner_user_id, batch_id)
);
"""
