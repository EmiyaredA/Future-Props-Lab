"""Extend independent Agents storage for queue and activity projections."""

SQL = """
ALTER TABLE agent_workbench_entries ADD COLUMN presentation JSON NOT NULL DEFAULT '{}';
CREATE INDEX ix_workbench_history_order
    ON agent_workbench_entries(session_id, ordinal, native_id);
ALTER TABLE workbench_chats ADD COLUMN queue_paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workbench_turns ADD COLUMN started_at INTEGER;
ALTER TABLE workbench_turns ADD COLUMN activity JSON NOT NULL DEFAULT '[]';
ALTER TABLE workbench_turns ADD COLUMN queued_session_id TEXT;
ALTER TABLE workbench_turns ADD COLUMN queued_local INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workbench_turns ADD COLUMN instructions JSON NOT NULL DEFAULT '[]';
"""
