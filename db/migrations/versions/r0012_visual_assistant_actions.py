MIGRATION_ID = "r0012_visual_assistant_actions"

SQL = r"""
CREATE TABLE visual_assistant_actions (
  id VARCHAR(36) PRIMARY KEY,
  message_id VARCHAR(36) NOT NULL
    REFERENCES visual_assistant_messages(id) ON DELETE CASCADE,
  action_id VARCHAR(160) NOT NULL,
  run_id VARCHAR(36) NOT NULL,
  approval_group_id VARCHAR(36),
  position INTEGER NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  effect VARCHAR(16) NOT NULL CHECK (effect IN ('read', 'write', 'external')),
  status VARCHAR(24) NOT NULL CHECK (
    status IN (
      'proposed', 'waiting_approval', 'running', 'completed',
      'rejected', 'failed', 'cancelled'
    )
  ),
  display_payload JSON NOT NULL DEFAULT '{}',
  result_payload JSON NOT NULL DEFAULT '{}',
  error_message TEXT,
  duration_ms INTEGER,
  canvas_revision INTEGER,
  generation_task_id VARCHAR(36)
    REFERENCES visual_generation_tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_visual_assistant_action_id UNIQUE (message_id, action_id),
  CONSTRAINT uq_visual_assistant_action_position UNIQUE (message_id, position)
);
CREATE INDEX ix_visual_assistant_actions_message
  ON visual_assistant_actions(message_id, position);
CREATE INDEX ix_visual_assistant_actions_run
  ON visual_assistant_actions(run_id, status);
CREATE INDEX ix_visual_assistant_actions_generation_task
  ON visual_assistant_actions(generation_task_id);
"""
