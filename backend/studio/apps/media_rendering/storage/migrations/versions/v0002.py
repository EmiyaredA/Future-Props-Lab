"""Own the frozen Motion export queue and execution receipts."""

SQL = """
CREATE TABLE motion_render_jobs (
    owner_user_id VARCHAR(128) NOT NULL,
    id VARCHAR(32) NOT NULL,
    project_id VARCHAR(128) NOT NULL,
    request_path VARCHAR(512) NOT NULL,
    assertion TEXT NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(16) NOT NULL,
    progress INTEGER NOT NULL,
    outputs JSON NOT NULL,
    error TEXT,
    cancel_requested BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, id)
);
CREATE INDEX motion_render_queue ON motion_render_jobs(status, created_at);
"""
