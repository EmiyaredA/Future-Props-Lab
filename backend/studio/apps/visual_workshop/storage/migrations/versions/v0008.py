"""Keep source activation and the model result projection recoverable."""

SQL = """
CREATE TABLE visual_generation_decisions (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(128) NOT NULL,
    plan_sha256 VARCHAR(64) NOT NULL,
    state VARCHAR(16) NOT NULL CHECK(state IN (
        'preparing', 'activate', 'abort', 'active', 'aborted'
    )),
    source_path TEXT NOT NULL,
    source_assertion TEXT NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_visual_generation_decisions_state ON visual_generation_decisions(state, updated_at);
CREATE TABLE visual_generation_dispatches (
    task_id VARCHAR(36) PRIMARY KEY REFERENCES visual_generation_tasks(id) ON DELETE CASCADE,
    owner_user_id VARCHAR(36) NOT NULL,
    plan_id VARCHAR(36) NOT NULL REFERENCES visual_generation_decisions(id) ON DELETE RESTRICT,
    provider_revision INTEGER NOT NULL,
    pending_asset_id VARCHAR(36),
    pending_receipt_id VARCHAR(128),
    remote_output_sha256 VARCHAR(64),
    retry_assertion TEXT,
    checked_at DATETIME NOT NULL,
    CHECK((pending_asset_id IS NULL) = (pending_receipt_id IS NULL))
);
CREATE INDEX ix_visual_generation_dispatches_checked ON visual_generation_dispatches(checked_at);
"""
