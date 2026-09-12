"""Workspace-owned standalone model invocations and immutable private inputs."""

MIGRATION_ID = "0060_model_inference"
SQL = """
CREATE TABLE model_inference_tasks (
 id VARCHAR(36) PRIMARY KEY NOT NULL,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 request_id VARCHAR(64) NOT NULL,
 fingerprint VARCHAR(64) NOT NULL,
 provider_id VARCHAR(36) REFERENCES model_providers(id) ON DELETE SET NULL,
 model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
 provider_kind VARCHAR(40) NOT NULL, provider_name VARCHAR(160) NOT NULL,
 model_slug VARCHAR(160) NOT NULL, kind VARCHAR(24) NOT NULL,
 request_payload JSON NOT NULL, status VARCHAR(24) NOT NULL, progress INTEGER NOT NULL,
 provider_task_id TEXT NOT NULL, result_url TEXT NOT NULL,
 result_storage_key VARCHAR(64) NOT NULL, result_filename VARCHAR(255) NOT NULL,
 result_mime_type VARCHAR(120) NOT NULL, result_byte_size INTEGER NOT NULL,
 result JSON NOT NULL, error_message TEXT, log_id VARCHAR(36), revision INTEGER NOT NULL,
 created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
 UNIQUE(workspace_id, request_id)
);
CREATE INDEX ix_model_inference_tasks_workspace_status
 ON model_inference_tasks(workspace_id, status);
CREATE TABLE model_inference_assets (
 id VARCHAR(36) PRIMARY KEY NOT NULL,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 task_id VARCHAR(36) REFERENCES model_inference_tasks(id) ON DELETE CASCADE,
 storage_key VARCHAR(64) NOT NULL, filename VARCHAR(255) NOT NULL,
 mime_type VARCHAR(120) NOT NULL, media_kind VARCHAR(24) NOT NULL,
 byte_size INTEGER NOT NULL, created_at DATETIME NOT NULL
);
CREATE INDEX ix_model_inference_assets_workspace_id ON model_inference_assets(workspace_id);
CREATE INDEX ix_model_inference_assets_task_id ON model_inference_assets(task_id);
"""
