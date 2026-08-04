MIGRATION_ID = "r0011_visual_assistant_conversations"

SQL = r"""
CREATE TABLE visual_assistant_conversations (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL
    REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL DEFAULT 'AI 助手对话',
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_visual_assistant_conversations_project_updated
  ON visual_assistant_conversations(project_id, updated_at DESC, created_at DESC);
CREATE INDEX ix_visual_assistant_conversations_model
  ON visual_assistant_conversations(model_id);

CREATE TABLE visual_assistant_messages (
  id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL
    REFERENCES visual_assistant_conversations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  turn_id VARCHAR(36) NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  model_slug VARCHAR(160) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL CHECK (
    status IN ('pending', 'completed', 'error', 'cancelled')
  ),
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_visual_assistant_message_position
    UNIQUE (conversation_id, position)
);
CREATE INDEX ix_visual_assistant_messages_conversation
  ON visual_assistant_messages(conversation_id, position);
CREATE INDEX ix_visual_assistant_messages_turn
  ON visual_assistant_messages(turn_id);
CREATE INDEX ix_visual_assistant_messages_status
  ON visual_assistant_messages(status);

CREATE TABLE visual_assistant_message_assets (
  id VARCHAR(36) PRIMARY KEY,
  message_id VARCHAR(36) NOT NULL
    REFERENCES visual_assistant_messages(id) ON DELETE CASCADE,
  asset_id VARCHAR(36) NOT NULL
    REFERENCES visual_assets(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  CONSTRAINT uq_visual_assistant_message_asset_position
    UNIQUE (message_id, position),
  CONSTRAINT uq_visual_assistant_message_asset
    UNIQUE (message_id, asset_id)
);
CREATE INDEX ix_visual_assistant_message_assets_asset
  ON visual_assistant_message_assets(asset_id);
"""
