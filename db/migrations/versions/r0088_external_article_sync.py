"""Workspace external connections and durable article sync."""

MIGRATION_ID = "0088_external_article_sync"
SQL = """
CREATE TABLE integration_external_connections (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	provider VARCHAR(24) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	app_id VARCHAR(120) NOT NULL, 
	secret_ciphertext TEXT NOT NULL, 
	enabled BOOLEAN NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	status_message VARCHAR(500) NOT NULL, 
	last_checked_at DATETIME, 
	revision INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (workspace_id, name), 
	FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
);

CREATE INDEX ix_integration_external_connections_workspace_id ON integration_external_connections (workspace_id);

CREATE TABLE thought_sync_bindings (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	note_id VARCHAR(36) NOT NULL, 
	connection_id VARCHAR(36) NOT NULL, 
	document_id VARCHAR(200) NOT NULL, 
	target_key VARCHAR(240) NOT NULL, 
	url VARCHAR(2048) NOT NULL, 
	title VARCHAR(240) NOT NULL, 
	revision INTEGER NOT NULL, 
	last_fingerprint VARCHAR(64) NOT NULL, 
	last_note_revision INTEGER, 
	last_synced_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (note_id), 
	UNIQUE (target_key), 
	FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE, 
	FOREIGN KEY(note_id) REFERENCES thought_notes (id) ON DELETE CASCADE, 
	FOREIGN KEY(connection_id) REFERENCES integration_external_connections (id) ON DELETE RESTRICT
);

CREATE INDEX ix_thought_sync_bindings_workspace_id ON thought_sync_bindings (workspace_id);

CREATE TABLE thought_sync_tasks (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	note_id VARCHAR(36) NOT NULL, 
	binding_id VARCHAR(36) NOT NULL, 
	binding_revision INTEGER NOT NULL, 
	connection_id VARCHAR(36) NOT NULL, 
	connection_revision INTEGER NOT NULL, 
	target_key VARCHAR(240) NOT NULL, 
	actor JSON NOT NULL, 
	operation_id VARCHAR(36), 
	note_revision INTEGER NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	content JSON NOT NULL, 
	remote JSON NOT NULL, 
	checkpoint JSON NOT NULL, 
	message TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (workspace_id, operation_id), 
	FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
);

CREATE INDEX ix_thought_sync_tasks_note_id ON thought_sync_tasks (note_id);

CREATE INDEX ix_thought_sync_tasks_workspace_id ON thought_sync_tasks (workspace_id);

CREATE UNIQUE INDEX uq_thought_sync_active_target ON thought_sync_tasks (target_key) WHERE status IN ('queued','running','needs_review');

CREATE TABLE thought_sync_steps (
	id VARCHAR(36) NOT NULL, 
	task_id VARCHAR(36) NOT NULL, 
	kind VARCHAR(32) NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	result JSON NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(task_id) REFERENCES thought_sync_tasks (id) ON DELETE CASCADE
);

CREATE INDEX ix_thought_sync_steps_task_id ON thought_sync_steps (task_id);

CREATE TABLE thought_sync_assets (
	task_id VARCHAR(36) NOT NULL, 
	asset_id VARCHAR(36) NOT NULL, 
	PRIMARY KEY (task_id, asset_id), 
	FOREIGN KEY(task_id) REFERENCES thought_sync_tasks (id) ON DELETE CASCADE, 
	FOREIGN KEY(asset_id) REFERENCES visual_assets (id) ON DELETE RESTRICT
);
"""
# ruff: noqa: E501
