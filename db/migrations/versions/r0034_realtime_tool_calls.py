# ruff: noqa: E501

MIGRATION_ID = "r0034_realtime_tool_calls"

SQL = r"""
ALTER TABLE model_test_tool_calls RENAME TO model_test_tool_calls_old;

CREATE TABLE model_test_tool_calls (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  tool_id VARCHAR(36) REFERENCES model_test_tools(id) ON DELETE SET NULL,
  conversation_id VARCHAR(36) REFERENCES model_test_conversations(id) ON DELETE SET NULL,
  message_id VARCHAR(36) REFERENCES model_test_messages(id) ON DELETE SET NULL,
  source VARCHAR(16) NOT NULL CHECK (source IN ('dry_run', 'model_test', 'realtime_voice')),
  action_id VARCHAR(160) NOT NULL DEFAULT '',
  run_id VARCHAR(36) NOT NULL DEFAULT '',
  round_index INTEGER NOT NULL DEFAULT 0 CHECK (round_index >= 0),
  tool_name VARCHAR(64) NOT NULL,
  tool_revision INTEGER NOT NULL DEFAULT 0 CHECK (tool_revision >= 0),
  definition_snapshot JSON NOT NULL DEFAULT '{}',
  arguments JSON NOT NULL DEFAULT '{}',
  status VARCHAR(16) NOT NULL CHECK (status IN ('proposed', 'running', 'completed', 'failed', 'cancelled')),
  success BOOLEAN,
  result JSON,
  error_code VARCHAR(120) NOT NULL DEFAULT '',
  error_message VARCHAR(1000) NOT NULL DEFAULT '',
  configured_delay_ms INTEGER NOT NULL DEFAULT 0 CHECK (configured_delay_ms >= 0),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (message_id, action_id)
);

INSERT INTO model_test_tool_calls (
  id, workspace_id, tool_id, conversation_id, message_id, source, action_id,
  run_id, round_index, tool_name, tool_revision, definition_snapshot,
  arguments, status, success, result, error_code, error_message,
  configured_delay_ms, duration_ms, created_at, updated_at
)
SELECT
  id, workspace_id, tool_id, conversation_id, message_id, source, action_id,
  run_id, round_index, tool_name, tool_revision, definition_snapshot,
  arguments, status, success, result, error_code, error_message,
  configured_delay_ms, duration_ms, created_at, updated_at
FROM model_test_tool_calls_old;

DROP TABLE model_test_tool_calls_old;

CREATE INDEX ix_model_test_tool_calls_workspace_created
  ON model_test_tool_calls(workspace_id, created_at);
CREATE INDEX ix_model_test_tool_calls_tool_created
  ON model_test_tool_calls(tool_id, created_at);
CREATE INDEX ix_model_test_tool_calls_message
  ON model_test_tool_calls(message_id, created_at);
"""
