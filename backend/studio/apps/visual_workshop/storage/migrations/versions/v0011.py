"""Retire the Visual service's project conversation history."""

SQL = """
CREATE TEMP TABLE visual_dialogue_retirement_guard (
    unsettled INTEGER NOT NULL CHECK (unsettled = 0)
);
INSERT INTO visual_dialogue_retirement_guard
SELECT COUNT(*) FROM visual_assistant_dispatches;
INSERT INTO visual_dialogue_retirement_guard
SELECT COUNT(*) FROM visual_assistant_messages WHERE status = 'pending';
INSERT INTO visual_dialogue_retirement_guard
SELECT COUNT(*) FROM visual_assistant_actions
WHERE status IN ('proposed', 'waiting_approval', 'running');
INSERT INTO visual_dialogue_retirement_guard
SELECT COUNT(*) FROM visual_canvas_reference_mutations
WHERE state IN ('commit', 'abort', 'preparing')
  AND (json_extract(change, '$.resource_kind') = 'conversation'
    OR json_array_length(change, '$.visual_project_removal') > 0);
DROP TABLE visual_dialogue_retirement_guard;

DELETE FROM visual_canvas_reference_mutations
WHERE json_extract(change, '$.resource_kind') = 'conversation';
DELETE FROM visual_migration_receipts WHERE dataset IN (
    'visual.assistant-conversations', 'visual.assistant-messages',
    'visual.assistant-attachments', 'visual.assistant-actions', 'visual.conversation-pins'
);
DROP TABLE visual_assistant_dispatches;
DROP TABLE visual_assistant_actions;
DROP TABLE visual_assistant_message_assets;
DROP TABLE visual_assistant_messages;
DROP TABLE visual_assistant_conversations;
"""
