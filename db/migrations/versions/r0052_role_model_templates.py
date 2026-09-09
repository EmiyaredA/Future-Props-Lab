MIGRATION_ID = "r0052_role_model_templates"
SQL = """
ALTER TABLE model_providers ADD COLUMN origin VARCHAR(20) NOT NULL DEFAULT 'user';
ALTER TABLE model_providers ADD COLUMN template_key VARCHAR(100);
ALTER TABLE model_entries ADD COLUMN origin VARCHAR(20) NOT NULL DEFAULT 'user';
ALTER TABLE model_entries ADD COLUMN template_key VARCHAR(100);
CREATE UNIQUE INDEX uq_provider_template ON model_providers(workspace_id, template_key);
CREATE UNIQUE INDEX uq_model_template ON model_entries(workspace_id, template_key);
CREATE TABLE model_template_sync_jobs (
 id VARCHAR(36) PRIMARY KEY, role VARCHAR(16) NOT NULL,
 template_revision INTEGER NOT NULL, template_snapshot JSON NOT NULL,
 actor_user_id VARCHAR(36) NOT NULL REFERENCES users(id),
 status VARCHAR(16) NOT NULL DEFAULT 'preview', revision INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uq_active_template_sync_role ON model_template_sync_jobs(role)
 WHERE status IN ('pending','running');
CREATE TABLE model_template_sync_items (
 id VARCHAR(36) PRIMARY KEY,
 job_id VARCHAR(36) NOT NULL REFERENCES model_template_sync_jobs(id) ON DELETE CASCADE,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
 workspace_name VARCHAR(255) NOT NULL,
 catalog_revision INTEGER NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending',
 summary JSON NOT NULL, error_message TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(job_id, workspace_id)
);
"""
