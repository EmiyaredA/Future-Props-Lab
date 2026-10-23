"""Allow explicitly configured DeepSeek connections without changing existing catalogs."""

MIGRATION_ID = "0107_deepseek_provider"
SQL = """

PRAGMA legacy_alter_table = ON;
ALTER TABLE model_providers RENAME TO model_providers_r0107_old;
CREATE TABLE model_providers (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default',
  origin VARCHAR(20) NOT NULL DEFAULT 'user',
  template_key VARCHAR(100),
  name VARCHAR(120) NOT NULL,
  supplier_id VARCHAR(36) REFERENCES model_suppliers(id) ON DELETE RESTRICT,
  kind VARCHAR(24) NOT NULL CHECK (
    kind IN (
      'openai', 'deepseek', 'anthropic', 'senseaudio_image', 'volcengine_image', 'senseaudio_video',
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
FROM model_providers_r0107_old;
DROP TABLE model_providers_r0107_old;
CREATE INDEX ix_model_providers_workspace ON model_providers(workspace_id, sort_order);
CREATE INDEX ix_model_providers_supplier_id ON model_providers(supplier_id);
CREATE UNIQUE INDEX uq_provider_template ON model_providers(workspace_id, template_key);

PRAGMA legacy_alter_table = OFF;

"""
