"""Durable node acceptance dispatch owned by Visual."""

SQL = """
CREATE TABLE visual_review_dispatches (
    run_id TEXT PRIMARY KEY NOT NULL REFERENCES visual_acceptance_runs(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL,
    assertion TEXT NOT NULL,
    source_path TEXT NOT NULL,
    executor JSON NOT NULL,
    retention_receipt TEXT NOT NULL,
    checked_at DATETIME NOT NULL
);
CREATE INDEX ix_visual_review_dispatches_checked_at ON visual_review_dispatches(checked_at);
"""
