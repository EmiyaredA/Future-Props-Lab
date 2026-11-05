"""Workbench-only initial schema. External identity references are validated by contracts."""

SQL = """CREATE TABLE agent_native_jobs (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	request_id VARCHAR(200) NOT NULL,
	operation VARCHAR(100) NOT NULL,
	payload_sha256 VARCHAR(64) NOT NULL,
	payload JSON NOT NULL,
	status VARCHAR(16) NOT NULL,
	worker_id VARCHAR(100) NOT NULL,
	lease_id VARCHAR(36) NOT NULL,
	lease_expires_at DATETIME,
	outcome_sha256 VARCHAR(64),
	result JSON,
	error_code VARCHAR(100) NOT NULL,
	message TEXT NOT NULL,
	revision INTEGER NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (owner_user_id, request_id)
);

CREATE INDEX ix_agent_native_jobs_owner_user_id ON agent_native_jobs (owner_user_id);

CREATE INDEX ix_agent_native_jobs_status ON agent_native_jobs (status);

CREATE TABLE agent_native_worker_seen (
	id VARCHAR(100) NOT NULL,
	last_seen_at DATETIME NOT NULL,
	PRIMARY KEY (id)
);

CREATE TABLE agent_workbench_changes (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	owner_user_id VARCHAR(36) NOT NULL,
	session_id VARCHAR(36),
	kind VARCHAR(24) NOT NULL,
	created_at DATETIME NOT NULL
);

CREATE INDEX ix_agent_workbench_changes_owner_user_id ON agent_workbench_changes (owner_user_id);

CREATE INDEX ix_agent_workbench_changes_session_id ON agent_workbench_changes (session_id);

CREATE TABLE agent_workbench_sessions (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	agent_id VARCHAR(24) NOT NULL,
	native_id VARCHAR(255) NOT NULL,
	title VARCHAR(120) NOT NULL,
	alias VARCHAR(120) NOT NULL,
	favorite BOOLEAN NOT NULL,
	revision INTEGER NOT NULL,
	cwd TEXT NOT NULL,
	origins JSON NOT NULL,
	evidence JSON NOT NULL,
	native_model VARCHAR(255) NOT NULL,
	parent_native_id VARCHAR(255),
	archived BOOLEAN NOT NULL,
	updated_at VARCHAR(64) NOT NULL,
	last_synced_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (owner_user_id, agent_id, native_id)
);

CREATE INDEX ix_agent_workbench_sessions_owner_user_id ON agent_workbench_sessions (owner_user_id);

CREATE TABLE agent_workbench_sources (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	agent_id VARCHAR(24) NOT NULL,
	label VARCHAR(120) NOT NULL,
	root TEXT NOT NULL,
	endpoint VARCHAR(255) NOT NULL,
	enabled BOOLEAN NOT NULL,
	revision INTEGER NOT NULL,
	status VARCHAR(24) NOT NULL,
	message VARCHAR(500) NOT NULL,
	last_synced_at DATETIME,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (agent_id, root, endpoint)
);

CREATE INDEX ix_agent_workbench_sources_owner_user_id ON agent_workbench_sources (owner_user_id);

CREATE TABLE agent_native_projection_receipts (
	source_id VARCHAR(36) NOT NULL,
	locator_sha256 VARCHAR(64) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	source_revision INTEGER NOT NULL,
	frame_id VARCHAR(36) NOT NULL,
	payload_sha256 VARCHAR(64) NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (source_id, locator_sha256),
	FOREIGN KEY(source_id) REFERENCES agent_workbench_sources (id) ON DELETE CASCADE
);

CREATE INDEX ix_agent_native_projection_receipts_owner_user_id
    ON agent_native_projection_receipts (owner_user_id);

CREATE TABLE agent_native_subscriptions (
	source_id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	current_job_id VARCHAR(36) NOT NULL,
	source_revision INTEGER NOT NULL,
	authorization_revision INTEGER NOT NULL,
	scan_epoch VARCHAR(100) NOT NULL,
	attempt INTEGER NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (source_id),
	FOREIGN KEY(source_id) REFERENCES agent_workbench_sources (id) ON DELETE CASCADE,
	FOREIGN KEY(current_job_id) REFERENCES agent_native_jobs (id)
);

CREATE INDEX ix_agent_native_subscriptions_owner_user_id
    ON agent_native_subscriptions (owner_user_id);

CREATE TABLE agent_workbench_checkpoints (
	id VARCHAR(36) NOT NULL,
	source_id VARCHAR(36) NOT NULL,
	session_id VARCHAR(36),
	locator TEXT NOT NULL,
	state JSON NOT NULL,
	error VARCHAR(500) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(source_id) REFERENCES agent_workbench_sources (id) ON DELETE CASCADE,
	UNIQUE (source_id, locator),
	FOREIGN KEY(session_id) REFERENCES agent_workbench_sessions (id) ON DELETE CASCADE
);

CREATE INDEX ix_agent_workbench_checkpoints_session_id ON agent_workbench_checkpoints (session_id);

CREATE INDEX ix_agent_workbench_checkpoints_source_id ON agent_workbench_checkpoints (source_id);

CREATE TABLE agent_workbench_entries (
	id VARCHAR(36) NOT NULL,
	session_id VARCHAR(36) NOT NULL,
	native_id VARCHAR(255) NOT NULL,
	ordinal INTEGER NOT NULL,
	role VARCHAR(24) NOT NULL,
	kind VARCHAR(32) NOT NULL,
	text TEXT NOT NULL,
	timestamp VARCHAR(64) NOT NULL,
	parent_id VARCHAR(255),
	tool_name VARCHAR(255) NOT NULL,
	attachments JSON NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (session_id, native_id),
	FOREIGN KEY(session_id) REFERENCES agent_workbench_sessions (id) ON DELETE CASCADE
);

CREATE INDEX ix_agent_workbench_entries_ordinal ON agent_workbench_entries (ordinal);

CREATE INDEX ix_agent_workbench_entries_session_id ON agent_workbench_entries (session_id);

CREATE TABLE agent_workbench_operations (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	source_id VARCHAR(36) NOT NULL,
	status VARCHAR(24) NOT NULL,
	message VARCHAR(500) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(source_id) REFERENCES agent_workbench_sources (id) ON DELETE CASCADE
);

CREATE INDEX ix_agent_workbench_operations_owner_user_id
    ON agent_workbench_operations (owner_user_id);

CREATE VIRTUAL TABLE agent_workbench_search USING fts5(
owner_user_id UNINDEXED, session_id UNINDEXED, entry_id UNINDEXED, text, tokenize='unicode61'
);

CREATE INDEX ix_agent_operations_source_created
ON agent_workbench_operations(source_id, created_at);
"""
