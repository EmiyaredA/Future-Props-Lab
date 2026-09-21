"""Durable Amadeus runs, ordered events, and action/message ownership."""

MIGRATION_ID = "r0072_amadeus_runs"

SQL = """
CREATE TABLE amadeus_runs (
 id VARCHAR(36) PRIMARY KEY,
 conversation_id VARCHAR(36) NOT NULL REFERENCES amadeus_conversations(id) ON DELETE CASCADE,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 model_id VARCHAR(36) NOT NULL,
 status VARCHAR(24) NOT NULL,
 active_owner_key VARCHAR(100) UNIQUE,
 context_json JSON NOT NULL,
 references_json JSON NOT NULL,
 capabilities_json JSON NOT NULL,
 partial_text TEXT NOT NULL DEFAULT '',
 last_event_sequence INTEGER NOT NULL DEFAULT 0,
 heartbeat_at DATETIME NOT NULL,
 error_message TEXT,
 response_message_id VARCHAR(36),
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 finished_at DATETIME
);
CREATE INDEX ix_amadeus_runs_owner_updated
 ON amadeus_runs(workspace_id, user_id, updated_at);
CREATE INDEX ix_amadeus_runs_conversation_created
 ON amadeus_runs(conversation_id, created_at);

CREATE TABLE amadeus_run_events (
 id VARCHAR(36) PRIMARY KEY,
 run_id VARCHAR(36) NOT NULL REFERENCES amadeus_runs(id) ON DELETE CASCADE,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL,
 kind VARCHAR(40) NOT NULL,
 payload_json JSON NOT NULL,
 idempotency_key VARCHAR(120) NOT NULL,
 created_at DATETIME NOT NULL,
 UNIQUE(run_id, sequence),
 UNIQUE(run_id, idempotency_key)
);
CREATE INDEX ix_amadeus_run_events_run_sequence
 ON amadeus_run_events(run_id, sequence);

ALTER TABLE amadeus_messages ADD COLUMN run_id VARCHAR(36) REFERENCES amadeus_runs(id);
ALTER TABLE amadeus_messages ADD COLUMN status VARCHAR(24) NOT NULL DEFAULT 'completed';
CREATE INDEX ix_amadeus_messages_run ON amadeus_messages(run_id);

ALTER TABLE amadeus_actions ADD COLUMN run_id VARCHAR(36) REFERENCES amadeus_runs(id);
CREATE INDEX ix_amadeus_actions_run ON amadeus_actions(run_id);
"""
