"""Workspace-scoped Amadeus conversations and audit of approved actions."""

MIGRATION_ID = "r0070_amadeus"

SQL = """
CREATE TABLE amadeus_conversations (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 model_id VARCHAR(36),
 revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
CREATE INDEX ix_amadeus_conversations_owner_updated
 ON amadeus_conversations(workspace_id, user_id, updated_at);
CREATE TABLE amadeus_messages (
 id VARCHAR(36) PRIMARY KEY,
 conversation_id VARCHAR(36) NOT NULL REFERENCES amadeus_conversations(id) ON DELETE CASCADE,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 role VARCHAR(16) NOT NULL,
 content TEXT NOT NULL,
 references_json JSON NOT NULL,
 created_at DATETIME NOT NULL
);
CREATE INDEX ix_amadeus_messages_conversation_created
 ON amadeus_messages(conversation_id, created_at);
CREATE TABLE amadeus_actions (
 id VARCHAR(36) PRIMARY KEY,
 conversation_id VARCHAR(36) NOT NULL REFERENCES amadeus_conversations(id) ON DELETE CASCADE,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 tool_name VARCHAR(120) NOT NULL,
 arguments_json JSON NOT NULL,
 arguments_sha256 VARCHAR(64) NOT NULL,
 status VARCHAR(24) NOT NULL,
 result_json JSON,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
CREATE INDEX ix_amadeus_actions_conversation_created
 ON amadeus_actions(conversation_id, created_at);
"""
