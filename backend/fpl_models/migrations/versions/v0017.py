"""Own provider plans and their immutable Visual inputs in Models."""

SQL = """
CREATE TABLE model_visual_provider_batches (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(128) NOT NULL,
    plan_sha256 VARCHAR(64) NOT NULL,
    state VARCHAR(16) NOT NULL CHECK(state IN ('prepared', 'active', 'aborted')),
    source_path TEXT,
    source_assertion TEXT,
    input_key VARCHAR(64),
    input_assets JSON NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE TABLE model_visual_provider_tasks (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(36) NOT NULL REFERENCES model_visual_provider_batches(id) ON DELETE RESTRICT,
    provider_id VARCHAR(36) NOT NULL,
    model_id VARCHAR(36) NOT NULL,
    provider_kind VARCHAR(24) NOT NULL,
    model_slug VARCHAR(160) NOT NULL,
    generation_kind VARCHAR(16) NOT NULL,
    request_payload JSON NOT NULL,
    provider_task_id VARCHAR(255),
    status VARCHAR(16) NOT NULL CHECK(status IN (
        'prepared', 'queued', 'submitting', 'pending', 'processing', 'completed', 'failed',
        'cancelled'
    )),
    progress INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    execution_info JSON,
    error_message TEXT,
    result_url TEXT,
    result_metadata JSON,
    last_retry_revision INTEGER,
    submitted_at DATETIME,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_model_visual_provider_tasks_state
    ON model_visual_provider_tasks(status, updated_at);
CREATE INDEX ix_model_visual_provider_tasks_plan ON model_visual_provider_tasks(batch_id);
"""
