"""Account-private, rebuildable native conversation projections and sync cursors."""

MIGRATION_ID = "0117_agent_workbench"

SQL = r"""
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
	UNIQUE (agent_id, root, endpoint), 
	FOREIGN KEY(owner_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_agent_workbench_sources_owner_user_id ON agent_workbench_sources (owner_user_id);

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
	UNIQUE (owner_user_id, agent_id, native_id), 
	FOREIGN KEY(owner_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_agent_workbench_sessions_owner_user_id ON agent_workbench_sessions (owner_user_id);

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

CREATE TABLE agent_workbench_checkpoints (
	id VARCHAR(36) NOT NULL, 
	source_id VARCHAR(36) NOT NULL, 
	session_id VARCHAR(36), 
	locator TEXT NOT NULL, 
	state JSON NOT NULL, 
	error VARCHAR(500) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (source_id, locator), 
	FOREIGN KEY(source_id) REFERENCES agent_workbench_sources (id) ON DELETE CASCADE, 
	FOREIGN KEY(session_id) REFERENCES agent_workbench_sessions (id) ON DELETE CASCADE
);

CREATE INDEX ix_agent_workbench_checkpoints_session_id ON agent_workbench_checkpoints (session_id);

CREATE INDEX ix_agent_workbench_checkpoints_source_id ON agent_workbench_checkpoints (source_id);

CREATE TABLE agent_workbench_operations (
	id VARCHAR(36) NOT NULL, 
	owner_user_id VARCHAR(36) NOT NULL, 
	source_id VARCHAR(36) NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	message VARCHAR(500) NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(source_id) REFERENCES agent_workbench_sources (id) ON DELETE CASCADE
);

CREATE INDEX ix_agent_workbench_operations_owner_user_id ON agent_workbench_operations (owner_user_id);

CREATE TABLE agent_workbench_changes (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, 
	owner_user_id VARCHAR(36) NOT NULL, 
	session_id VARCHAR(36), 
	kind VARCHAR(24) NOT NULL, 
	created_at DATETIME NOT NULL, 
	FOREIGN KEY(owner_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_agent_workbench_changes_owner_user_id ON agent_workbench_changes (owner_user_id);

CREATE INDEX ix_agent_workbench_changes_session_id ON agent_workbench_changes (session_id);

CREATE INDEX ix_workbench_history ON agent_workbench_entries(session_id, ordinal);

CREATE VIRTUAL TABLE agent_workbench_search USING fts5(owner_user_id UNINDEXED, session_id UNINDEXED, entry_id UNINDEXED, text, tokenize="unicode61");
"""  # noqa: E501 — preserve registered SQL text
