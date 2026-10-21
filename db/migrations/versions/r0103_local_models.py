"""Optional, deployment-wide local TTS installation records."""

MIGRATION_ID = "0103_local_models"
SQL = """

PRAGMA legacy_alter_table = ON;
ALTER TABLE model_providers RENAME TO model_providers_r0103_old;
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
      'volcengine_video', 'zealman_video',
      'senseaudio_asr', 'senseaudio_asr_pro', 'senseaudio_realtime',
      'senseaudio_music', 'senseaudio_sfx', 'local_qwen_tts'
    )
  ),
  base_url VARCHAR(512) NOT NULL DEFAULT '',
  api_key_ciphertext TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO model_providers (
 "id", "workspace_id", "origin", "template_key", "name", "supplier_id",
 "kind", "base_url", "api_key_ciphertext", "enabled", "sort_order",
 "created_at", "updated_at"
) SELECT
 "id", "workspace_id", "origin", "template_key", "name", "supplier_id",
 "kind", "base_url", "api_key_ciphertext", "enabled", "sort_order",
 "created_at", "updated_at"
FROM model_providers_r0103_old;
DROP TABLE model_providers_r0103_old;
CREATE INDEX ix_model_providers_workspace ON model_providers(workspace_id, sort_order);
CREATE INDEX ix_model_providers_supplier_id ON model_providers(supplier_id);
CREATE UNIQUE INDEX uq_provider_template ON model_providers(workspace_id, template_key);

PRAGMA legacy_alter_table = OFF;

CREATE TABLE local_model_installations (
 id VARCHAR(64) PRIMARY KEY NOT NULL, status VARCHAR(32) NOT NULL,
 enabled BOOLEAN NOT NULL, progress INTEGER NOT NULL, error_message TEXT,
 revision INTEGER NOT NULL, updated_at DATETIME NOT NULL
);
CREATE TABLE local_model_operations (
 model_id VARCHAR(64) NOT NULL, request_id VARCHAR(64) NOT NULL,
 fingerprint VARCHAR(64) NOT NULL, result JSON NOT NULL, created_at DATETIME NOT NULL,
 PRIMARY KEY (model_id, request_id)
);
"""
