# ruff: noqa: E501
"""Extend provider checks without changing existing connections or task records."""

MIGRATION_ID = "r0087_volcengine_images"
SQL = """
PRAGMA legacy_alter_table = ON;
ALTER TABLE model_providers RENAME TO model_providers_r0087_old;
CREATE TABLE model_providers (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default',
  origin VARCHAR(20) NOT NULL DEFAULT 'user',
  template_key VARCHAR(100),
  name VARCHAR(120) NOT NULL,
  supplier_id VARCHAR(36) REFERENCES model_suppliers(id) ON DELETE RESTRICT,
  kind VARCHAR(24) NOT NULL CHECK (
    kind IN (
      'openai', 'anthropic', 'senseaudio_image', 'volcengine_image', 'senseaudio_video',
      'senseaudio_asr', 'senseaudio_asr_pro', 'senseaudio_realtime',
      'senseaudio_music', 'senseaudio_sfx'
    )
  ),
  base_url VARCHAR(512) NOT NULL DEFAULT '',
  api_key_ciphertext TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO model_providers ("id", "workspace_id", "origin", "template_key", "name", "supplier_id", "kind", "base_url", "api_key_ciphertext", "enabled", "sort_order", "created_at", "updated_at") SELECT "id", "workspace_id", "origin", "template_key", "name", "supplier_id", "kind", "base_url", "api_key_ciphertext", "enabled", "sort_order", "created_at", "updated_at" FROM model_providers_r0087_old;
DROP TABLE model_providers_r0087_old;
CREATE INDEX ix_model_providers_workspace ON model_providers(workspace_id, sort_order);
CREATE INDEX ix_model_providers_supplier_id ON model_providers(supplier_id);
CREATE UNIQUE INDEX uq_provider_template ON model_providers(workspace_id, template_key);
ALTER TABLE visual_generation_tasks RENAME TO visual_generation_tasks_r0087_old;
CREATE TABLE visual_generation_tasks (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  provider_id VARCHAR(36) REFERENCES model_providers(id) ON DELETE SET NULL,
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  provider_kind VARCHAR(24) NOT NULL CHECK (
    provider_kind IN ('senseaudio_image', 'volcengine_image', 'senseaudio_video', 'senseaudio_music', 'senseaudio_sfx')
  ),
  generation_kind VARCHAR(16) NOT NULL CHECK (generation_kind IN ('image', 'video', 'audio')),
  provider_name VARCHAR(120) NOT NULL,
  model_slug VARCHAR(160) NOT NULL,
  request_payload JSON NOT NULL DEFAULT '{}',
  provider_task_id VARCHAR(255),
  status VARCHAR(16) NOT NULL CHECK (
    status IN ('queued', 'submitting', 'pending', 'processing', 'completed', 'failed')
  ),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_message TEXT,
  result_url TEXT,
  result_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default'
, canvas_node_id VARCHAR(64));
INSERT INTO visual_generation_tasks ("id", "project_id", "provider_id", "model_id", "provider_kind", "generation_kind", "provider_name", "model_slug", "request_payload", "provider_task_id", "status", "progress", "error_message", "result_url", "result_asset_id", "revision", "created_at", "updated_at", "completed_at", "workspace_id", "canvas_node_id") SELECT "id", "project_id", "provider_id", "model_id", "provider_kind", "generation_kind", "provider_name", "model_slug", "request_payload", "provider_task_id", "status", "progress", "error_message", "result_url", "result_asset_id", "revision", "created_at", "updated_at", "completed_at", "workspace_id", "canvas_node_id" FROM visual_generation_tasks_r0087_old;
DROP TABLE visual_generation_tasks_r0087_old;
CREATE INDEX ix_visual_generation_tasks_project_created
  ON visual_generation_tasks(project_id, created_at DESC);
CREATE INDEX ix_visual_generation_tasks_status_updated
  ON visual_generation_tasks(status, updated_at);
CREATE INDEX ix_visual_generation_tasks_provider
  ON visual_generation_tasks(provider_id, status);
CREATE INDEX ix_visual_generation_tasks_project_canvas_node_created
  ON visual_generation_tasks(project_id, canvas_node_id, created_at DESC);
ALTER TABLE model_test_generation_tasks RENAME TO model_test_generation_tasks_r0087_old;
CREATE TABLE model_test_generation_tasks (
  id VARCHAR(36) PRIMARY KEY,
  provider_id VARCHAR(36)
    REFERENCES model_providers(id) ON DELETE SET NULL,
  model_id VARCHAR(36)
    REFERENCES model_entries(id) ON DELETE SET NULL,
  provider_kind VARCHAR(24) NOT NULL CHECK (
    provider_kind IN ('senseaudio_image', 'volcengine_image', 'senseaudio_video')
  ),
  generation_kind VARCHAR(16) NOT NULL CHECK (generation_kind IN ('image', 'video')),
  provider_name VARCHAR(120) NOT NULL,
  model_slug VARCHAR(160) NOT NULL,
  request_payload JSON NOT NULL DEFAULT '{}',
  provider_task_id VARCHAR(255),
  status VARCHAR(16) NOT NULL CHECK (
    status IN ('queued', 'submitting', 'pending', 'processing', 'completed', 'failed')
  ),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_message TEXT,
  result_url TEXT,
  result_storage_key VARCHAR(64),
  result_filename VARCHAR(255),
  result_mime_type VARCHAR(120),
  result_byte_size INTEGER,
  log_id VARCHAR(36) REFERENCES llm_call_logs(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
, workspace_id VARCHAR(36) NOT NULL DEFAULT 'default', auth_kind VARCHAR(32), api_key_id VARCHAR(36), api_key_name VARCHAR(64), api_key_prefix VARCHAR(16));
INSERT INTO model_test_generation_tasks ("id", "provider_id", "model_id", "provider_kind", "generation_kind", "provider_name", "model_slug", "request_payload", "provider_task_id", "status", "progress", "error_message", "result_url", "result_storage_key", "result_filename", "result_mime_type", "result_byte_size", "log_id", "revision", "created_at", "updated_at", "completed_at", "workspace_id", "auth_kind", "api_key_id", "api_key_name", "api_key_prefix") SELECT "id", "provider_id", "model_id", "provider_kind", "generation_kind", "provider_name", "model_slug", "request_payload", "provider_task_id", "status", "progress", "error_message", "result_url", "result_storage_key", "result_filename", "result_mime_type", "result_byte_size", "log_id", "revision", "created_at", "updated_at", "completed_at", "workspace_id", "auth_kind", "api_key_id", "api_key_name", "api_key_prefix" FROM model_test_generation_tasks_r0087_old;
DROP TABLE model_test_generation_tasks_r0087_old;
CREATE INDEX ix_model_test_generation_status_updated
  ON model_test_generation_tasks(status, updated_at);
CREATE INDEX ix_model_test_generation_model_created
  ON model_test_generation_tasks(model_id, created_at DESC);
CREATE INDEX ix_model_test_generation_workspace
  ON model_test_generation_tasks(workspace_id, updated_at DESC);
PRAGMA legacy_alter_table = OFF;
"""
