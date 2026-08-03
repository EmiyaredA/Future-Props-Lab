MIGRATION_ID = "r0007_model_test_attachments"

SQL = r"""
CREATE TABLE model_test_attachments (
  id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL
    REFERENCES model_test_conversations(id) ON DELETE CASCADE,
  message_id VARCHAR(36)
    REFERENCES model_test_messages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  original_filename VARCHAR(255) NOT NULL,
  storage_key VARCHAR(64) NOT NULL UNIQUE,
  mime_type VARCHAR(120) NOT NULL
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  width INTEGER NOT NULL CHECK (width > 0 AND width <= 8000),
  height INTEGER NOT NULL CHECK (height > 0 AND height <= 8000),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_model_test_attachment_message_position UNIQUE (message_id, position)
);
CREATE INDEX ix_model_test_attachments_conversation
  ON model_test_attachments(conversation_id, message_id, position);
"""
