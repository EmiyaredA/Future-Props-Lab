"""Version-bound visual acceptance standards, evidence and review history."""

MIGRATION_ID = "0105_visual_acceptance"
SQL = """
CREATE TABLE visual_acceptance_templates (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	title VARCHAR(120) NOT NULL, 
	document JSON NOT NULL, 
	revision INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);
CREATE INDEX ix_visual_acceptance_templates_workspace_id ON visual_acceptance_templates (workspace_id);
CREATE TABLE visual_acceptance_standards (
	project_id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	draft JSON NOT NULL, 
	published_version INTEGER NOT NULL, 
	required BOOLEAN NOT NULL, 
	revision INTEGER NOT NULL, 
	PRIMARY KEY (project_id), 
	FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);
CREATE INDEX ix_visual_acceptance_standards_workspace_id ON visual_acceptance_standards (workspace_id);
CREATE TABLE visual_acceptance_standard_versions (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	project_id VARCHAR(36) NOT NULL, 
	version INTEGER NOT NULL, 
	document JSON NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (project_id, version), 
	FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);
CREATE INDEX ix_visual_acceptance_standard_versions_workspace_id ON visual_acceptance_standard_versions (workspace_id);
CREATE TABLE visual_acceptance_runs (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	project_id VARCHAR(36) NOT NULL, 
	node_id VARCHAR(64) NOT NULL, 
	output_id VARCHAR(36) NOT NULL, 
	standard_id VARCHAR(36) NOT NULL, 
	previous_run_id VARCHAR(36), 
	request_id VARCHAR(100) NOT NULL, 
	fingerprint VARCHAR(64) NOT NULL, 
	model_id VARCHAR(36), 
	status VARCHAR(24) NOT NULL, 
	decision VARCHAR(24) NOT NULL, 
	snapshot JSON NOT NULL, 
	results JSON NOT NULL, 
	evidence JSON NOT NULL, 
	decisions JSON NOT NULL, 
	error_message TEXT, 
	revision INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (project_id, request_id, output_id), 
	FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE, 
	FOREIGN KEY(output_id) REFERENCES visual_node_outputs (id) ON DELETE RESTRICT, 
	FOREIGN KEY(standard_id) REFERENCES visual_acceptance_standard_versions (id) ON DELETE RESTRICT
);
CREATE INDEX ix_visual_acceptance_runs_project_id ON visual_acceptance_runs (project_id);
CREATE INDEX ix_visual_acceptance_runs_workspace_id ON visual_acceptance_runs (workspace_id);
CREATE TABLE visual_acceptance_asset_references (
	owner_id VARCHAR(36) NOT NULL, 
	asset_id VARCHAR(36) NOT NULL, 
	project_id VARCHAR(36) NOT NULL, 
	PRIMARY KEY (owner_id, asset_id), 
	FOREIGN KEY(asset_id) REFERENCES visual_assets (id) ON DELETE RESTRICT, 
	FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);
CREATE INDEX ix_visual_acceptance_asset_references_project_id ON visual_acceptance_asset_references (project_id);
CREATE TABLE visual_acceptance_repair_drafts (
	id VARCHAR(36) NOT NULL, 
	workspace_id VARCHAR(36) NOT NULL, 
	project_id VARCHAR(36) NOT NULL, 
	run_id VARCHAR(36) NOT NULL, 
	text TEXT NOT NULL, 
	revision INTEGER NOT NULL, 
	prompt_version_id VARCHAR(64), 
	PRIMARY KEY (id), 
	FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE, 
	FOREIGN KEY(run_id) REFERENCES visual_acceptance_runs (id) ON DELETE CASCADE
);
CREATE INDEX ix_visual_acceptance_repair_drafts_workspace_id ON visual_acceptance_repair_drafts (workspace_id);
"""
