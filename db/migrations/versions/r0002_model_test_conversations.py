MIGRATION_ID = "r0002_model_test_conversations"

SQL = r"""
CREATE TABLE model_test_conversations (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(120) NOT NULL DEFAULT '新对话',
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  temperature REAL NOT NULL DEFAULT 0.7 CHECK (temperature >= 0 AND temperature <= 2),
  max_tokens INTEGER NOT NULL DEFAULT 1024 CHECK (max_tokens >= 1 AND max_tokens <= 8192),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_model_test_conversations_updated_at
  ON model_test_conversations(updated_at DESC);
CREATE INDEX ix_model_test_conversations_model_id
  ON model_test_conversations(model_id);

CREATE TABLE model_test_messages (
  id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL
    REFERENCES model_test_conversations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  turn_id VARCHAR(36) NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  model_slug VARCHAR(160) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL
    CHECK (status IN ('pending', 'completed', 'error', 'cancelled', 'superseded')),
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_model_test_message_position UNIQUE (conversation_id, position)
);
CREATE INDEX ix_model_test_messages_conversation
  ON model_test_messages(conversation_id, position);
CREATE INDEX ix_model_test_messages_turn_id ON model_test_messages(turn_id);
CREATE INDEX ix_model_test_messages_status ON model_test_messages(status);
"""
