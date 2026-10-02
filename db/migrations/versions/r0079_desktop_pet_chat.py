"""Per-user desktop pet chat and persistent messages."""

MIGRATION_ID = "r0079_desktop_pet_chat"
SQL = """
CREATE TABLE desktop_pet_chats (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_id VARCHAR(36) NOT NULL REFERENCES desktop_pet_projects(id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
 proactive_lines_enabled BOOLEAN NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 0,
 active_request_id VARCHAR(64),
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 UNIQUE (workspace_id, project_id, user_id)
);
CREATE INDEX ix_desktop_pet_chats_user ON desktop_pet_chats(user_id, workspace_id);
CREATE TABLE desktop_pet_chat_messages (
 id VARCHAR(36) PRIMARY KEY,
 chat_id VARCHAR(36) NOT NULL REFERENCES desktop_pet_chats(id) ON DELETE CASCADE,
 position INTEGER NOT NULL,
 request_id VARCHAR(64),
 role VARCHAR(16) NOT NULL,
 content TEXT NOT NULL,
 status VARCHAR(16) NOT NULL,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 UNIQUE (chat_id, position),
 UNIQUE (chat_id, request_id)
);
CREATE INDEX ix_desktop_pet_chat_messages_chat ON desktop_pet_chat_messages(chat_id, position);
CREATE TABLE desktop_pet_chat_requests (
 chat_id VARCHAR(36) NOT NULL REFERENCES desktop_pet_chats(id) ON DELETE CASCADE,
 request_id VARCHAR(64) NOT NULL,
 created_at DATETIME NOT NULL,
 PRIMARY KEY (chat_id, request_id)
);
"""
