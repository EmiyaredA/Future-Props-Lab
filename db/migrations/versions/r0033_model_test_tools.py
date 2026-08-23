# ruff: noqa: E501

MIGRATION_ID = "r0033_model_test_tools"

SQL = r"""
CREATE TABLE model_test_tools (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  input_schema JSON NOT NULL DEFAULT '{"type":"object","properties":{}}',
  mock_kind VARCHAR(16) NOT NULL DEFAULT 'success' CHECK (mock_kind IN ('success', 'failure')),
  mock_result JSON,
  error_code VARCHAR(120) NOT NULL DEFAULT '',
  error_message VARCHAR(1000) NOT NULL DEFAULT '',
  delay_ms INTEGER NOT NULL DEFAULT 0 CHECK (delay_ms >= 0 AND delay_ms <= 10000),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, name)
);
CREATE INDEX ix_model_test_tools_workspace_updated
  ON model_test_tools(workspace_id, updated_at);

CREATE TABLE model_test_conversation_tool_bindings (
  conversation_id VARCHAR(36) NOT NULL REFERENCES model_test_conversations(id) ON DELETE CASCADE,
  tool_id VARCHAR(36) NOT NULL REFERENCES model_test_tools(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, tool_id),
  UNIQUE (conversation_id, position)
);
CREATE INDEX ix_model_test_conversation_tool_bindings_tool
  ON model_test_conversation_tool_bindings(tool_id, conversation_id);

CREATE TABLE model_test_tool_calls (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  tool_id VARCHAR(36) REFERENCES model_test_tools(id) ON DELETE SET NULL,
  conversation_id VARCHAR(36) REFERENCES model_test_conversations(id) ON DELETE SET NULL,
  message_id VARCHAR(36) REFERENCES model_test_messages(id) ON DELETE SET NULL,
  source VARCHAR(16) NOT NULL CHECK (source IN ('dry_run', 'model_test')),
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
CREATE INDEX ix_model_test_tool_calls_workspace_created
  ON model_test_tool_calls(workspace_id, created_at);
CREATE INDEX ix_model_test_tool_calls_tool_created
  ON model_test_tool_calls(tool_id, created_at);
CREATE INDEX ix_model_test_tool_calls_message
  ON model_test_tool_calls(message_id, created_at);
"""
