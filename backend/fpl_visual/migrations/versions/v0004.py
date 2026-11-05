"""Fence an owned canvas while an incoming Video segment group is settled."""

SQL = """
CREATE TABLE visual_segment_handoffs (
    owner_user_id VARCHAR(36) NOT NULL,
    task_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(128) NOT NULL,
    scope_sha256 VARCHAR(64) NOT NULL,
    state VARCHAR(16) NOT NULL
        CHECK(state IN ('prepared','commit','published','aborting','aborted')),
    nodes JSON NOT NULL,
    result JSON,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, task_id)
);
CREATE INDEX ix_visual_segment_handoff_target
    ON visual_segment_handoffs(owner_user_id, project_id, state);
"""
