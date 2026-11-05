"""Recover Visual assistant source runs and Models settlements across restarts."""

SQL = """
CREATE TABLE visual_assistant_dispatches (
    run_id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(128) NOT NULL,
    conversation_id VARCHAR(36) NOT NULL
        REFERENCES visual_assistant_conversations(id) ON DELETE CASCADE,
    message_id VARCHAR(36)
        REFERENCES visual_assistant_messages(id) ON DELETE CASCADE,
    trace_id VARCHAR(36) NOT NULL,
    phase VARCHAR(16) NOT NULL,
    settlement JSON,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_visual_assistant_dispatches_phase
    ON visual_assistant_dispatches(phase, updated_at);
"""
