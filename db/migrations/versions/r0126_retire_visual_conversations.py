"""Retire Visual conversations and their model call logs in the website database."""

MIGRATION_ID = "0126_retire_visual_conversations"

SQL = """
CREATE TEMP TABLE visual_dialogue_retirement_guard (
    unsettled INTEGER NOT NULL CHECK (unsettled = 0)
);
INSERT INTO visual_dialogue_retirement_guard
SELECT COUNT(*) FROM visual_assistant_messages WHERE status = 'pending';
INSERT INTO visual_dialogue_retirement_guard
SELECT COUNT(*) FROM visual_assistant_actions
WHERE status IN ('proposed', 'waiting_approval', 'running');
DROP TABLE visual_dialogue_retirement_guard;

DROP TABLE visual_assistant_actions;
DROP TABLE visual_assistant_message_assets;
DROP TABLE visual_assistant_messages;
DROP TABLE visual_assistant_conversations;
DELETE FROM llm_call_logs WHERE call_source = 'visual_workshop_assistant';
"""
