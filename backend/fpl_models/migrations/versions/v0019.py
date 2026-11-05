"""Own the lease and receipts of a Visual assistant model run."""

SQL = """
CREATE TABLE visual_assistant_model_runs (
    owner_user_id VARCHAR(36) NOT NULL,
    run_id VARCHAR(128) NOT NULL,
    project_id VARCHAR(128) NOT NULL,
    conversation_id VARCHAR(128) NOT NULL,
    start_digest VARCHAR(64) NOT NULL,
    model_id VARCHAR(128) NOT NULL,
    model_signature VARCHAR(64) NOT NULL,
    model_plan JSON NOT NULL,
    request_summary JSON NOT NULL,
    trace_id VARCHAR(128) NOT NULL,
    lease_id VARCHAR(36) NOT NULL,
    state VARCHAR(16) NOT NULL,
    round_index INTEGER NOT NULL,
    round_digest VARCHAR(64),
    round_state VARCHAR(16),
    round_events JSON NOT NULL,
    usage JSON NOT NULL,
    settlement_sha256 VARCHAR(64),
    settlement JSON,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, run_id)
);
CREATE INDEX ix_visual_assistant_model_runs_state ON visual_assistant_model_runs(state, updated_at);
"""
