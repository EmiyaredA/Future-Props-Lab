"""Record Annotation import results in the same transaction as restored records."""

SQL = """
CREATE TABLE annotation_import_receipts (
    run_id VARCHAR(36) NOT NULL,
    dataset VARCHAR(64) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(36) NOT NULL,
    receipt JSON NOT NULL,
    PRIMARY KEY (run_id, dataset, owner_user_id, batch_id)
);
"""
