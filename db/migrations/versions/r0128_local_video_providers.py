"""Allow desktop video enhancement providers while preserving the account catalog."""

MIGRATION_ID = "0128_local_video_providers"

SQL = """
CREATE TABLE model_providers__video_upgrade (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL,
  origin VARCHAR(20) NOT NULL DEFAULT 'user',
  template_key VARCHAR(100),
  name VARCHAR(120) NOT NULL,
  supplier_id VARCHAR(36) REFERENCES model_suppliers(id) ON DELETE RESTRICT,
  kind VARCHAR(24) NOT NULL CHECK (
    kind IN (
      'openai', 'deepseek', 'anthropic', 'senseaudio_image', 'volcengine_image', 'senseaudio_video',
      'volcengine_video', 'zealman_video', 'autodl_video',
      'senseaudio_asr', 'senseaudio_asr_pro', 'senseaudio_realtime',
      'senseaudio_music', 'senseaudio_sfx', 'local_qwen_tts', 'local_relayvsr', 'local_ffmpeg'
    )
  ),
  base_url VARCHAR(512) NOT NULL DEFAULT '',
  api_key_ciphertext TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO model_providers__video_upgrade (
  id, owner_user_id, origin, template_key, name, supplier_id, kind,
  base_url, api_key_ciphertext, enabled, sort_order, created_at, updated_at
)
SELECT id, owner_user_id, origin, template_key, name, supplier_id, kind,
  base_url, api_key_ciphertext, enabled, sort_order, created_at, updated_at
FROM model_providers;
DROP TABLE model_providers;
ALTER TABLE model_providers__video_upgrade RENAME TO model_providers;
CREATE INDEX ix_model_providers_account ON model_providers(owner_user_id, sort_order);
CREATE INDEX ix_model_providers_supplier_id ON model_providers(supplier_id);
CREATE UNIQUE INDEX uq_provider_template ON model_providers(owner_user_id, template_key);
"""
