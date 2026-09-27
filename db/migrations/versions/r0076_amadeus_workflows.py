"""Persist Amadeus modes, continuation links and user questions."""

MIGRATION_ID = "r0076_amadeus_workflows"

SQL = """
ALTER TABLE amadeus_runs ADD COLUMN mode VARCHAR(12) NOT NULL DEFAULT 'agent';
ALTER TABLE amadeus_runs ADD COLUMN source_run_id VARCHAR(36)
 REFERENCES amadeus_runs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX ix_amadeus_runs_source_run_id ON amadeus_runs(source_run_id);

CREATE TABLE amadeus_questions (
 id VARCHAR(36) PRIMARY KEY,
 conversation_id VARCHAR(36) NOT NULL REFERENCES amadeus_conversations(id) ON DELETE CASCADE,
 run_id VARCHAR(36) NOT NULL UNIQUE REFERENCES amadeus_runs(id) ON DELETE CASCADE,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 tool_call_id VARCHAR(120) NOT NULL,
 prompt TEXT NOT NULL,
 options_json JSON NOT NULL,
 allow_text BOOLEAN NOT NULL,
 status VARCHAR(16) NOT NULL,
 answer_json JSON,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
CREATE INDEX ix_amadeus_questions_conversation_created
 ON amadeus_questions(conversation_id, created_at);
"""
