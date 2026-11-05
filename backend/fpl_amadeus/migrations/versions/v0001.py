"""Amadeus records with external identity validated at the HTTP boundary."""

SQL = """
CREATE TABLE amadeus_conversations (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	user_id VARCHAR(36) NOT NULL,
	executor_kind VARCHAR(24) NOT NULL,
	agent_id VARCHAR(24),
	title VARCHAR(120) NOT NULL,
	model_id VARCHAR(36),
	revision INTEGER NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id)
);

CREATE INDEX ix_amadeus_conversations_owner_updated
    ON amadeus_conversations (owner_user_id, user_id, updated_at);

CREATE TABLE amadeus_runs (
	id VARCHAR(36) NOT NULL,
	conversation_id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	user_id VARCHAR(36) NOT NULL,
	agent_id VARCHAR(24),
	agent_model VARCHAR(160) NOT NULL,
	execution_config JSON NOT NULL,
	model_id VARCHAR(36) NOT NULL,
	mode VARCHAR(12) NOT NULL,
	source_run_id VARCHAR(36),
	status VARCHAR(24) NOT NULL,
	active_owner_key VARCHAR(100),
	context_json JSON NOT NULL,
	references_json JSON NOT NULL,
	capabilities_json JSON NOT NULL,
	partial_text TEXT NOT NULL,
	last_event_sequence INTEGER NOT NULL,
	heartbeat_at DATETIME NOT NULL,
	error_message TEXT,
	response_message_id VARCHAR(36),
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	finished_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(conversation_id) REFERENCES amadeus_conversations (id) ON DELETE CASCADE,
	UNIQUE (source_run_id),
	FOREIGN KEY(source_run_id) REFERENCES amadeus_runs (id) ON DELETE SET NULL,
	UNIQUE (active_owner_key)
);

CREATE INDEX ix_amadeus_runs_conversation_created
    ON amadeus_runs (conversation_id, created_at);

CREATE INDEX ix_amadeus_runs_owner_updated
    ON amadeus_runs (owner_user_id, user_id, updated_at);

CREATE TABLE amadeus_messages (
	id VARCHAR(36) NOT NULL,
	conversation_id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	role VARCHAR(16) NOT NULL,
	content TEXT NOT NULL,
	references_json JSON NOT NULL,
	run_id VARCHAR(36),
	status VARCHAR(24) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(conversation_id) REFERENCES amadeus_conversations (id) ON DELETE CASCADE,
	FOREIGN KEY(run_id) REFERENCES amadeus_runs (id) ON DELETE SET NULL
);

CREATE INDEX ix_amadeus_messages_conversation_created
    ON amadeus_messages (conversation_id, created_at);

CREATE TABLE amadeus_actions (
	id VARCHAR(36) NOT NULL,
	conversation_id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	user_id VARCHAR(36) NOT NULL,
	tool_name VARCHAR(120) NOT NULL,
	arguments_json JSON NOT NULL,
	arguments_sha256 VARCHAR(64) NOT NULL,
	status VARCHAR(24) NOT NULL,
	result_json JSON,
	run_id VARCHAR(36),
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(conversation_id) REFERENCES amadeus_conversations (id) ON DELETE CASCADE,
	FOREIGN KEY(run_id) REFERENCES amadeus_runs (id) ON DELETE SET NULL
);

CREATE INDEX ix_amadeus_actions_conversation_created
    ON amadeus_actions (conversation_id, created_at);

CREATE TABLE amadeus_questions (
	id VARCHAR(36) NOT NULL,
	conversation_id VARCHAR(36) NOT NULL,
	run_id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	user_id VARCHAR(36) NOT NULL,
	tool_call_id VARCHAR(120) NOT NULL,
	prompt TEXT NOT NULL,
	options_json JSON NOT NULL,
	allow_text BOOLEAN NOT NULL,
	status VARCHAR(16) NOT NULL,
	answer_json JSON,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (run_id),
	FOREIGN KEY(conversation_id) REFERENCES amadeus_conversations (id) ON DELETE CASCADE,
	FOREIGN KEY(run_id) REFERENCES amadeus_runs (id) ON DELETE CASCADE
);

CREATE INDEX ix_amadeus_questions_conversation_created
    ON amadeus_questions (conversation_id, created_at);

CREATE TABLE amadeus_run_events (
	id VARCHAR(36) NOT NULL,
	run_id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	sequence INTEGER NOT NULL,
	kind VARCHAR(40) NOT NULL,
	payload_json JSON NOT NULL,
	idempotency_key VARCHAR(120) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (run_id, sequence),
	UNIQUE (run_id, idempotency_key),
	FOREIGN KEY(run_id) REFERENCES amadeus_runs (id) ON DELETE CASCADE
);

CREATE INDEX ix_amadeus_run_events_run_sequence
    ON amadeus_run_events (run_id, sequence);
"""
