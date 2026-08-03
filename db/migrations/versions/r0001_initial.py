MIGRATION_ID = "r0001_initial"

SQL = r"""
CREATE TABLE model_catalog_state (
  id VARCHAR(32) PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO model_catalog_state (id, revision) VALUES ('default', 0);

CREATE TABLE model_providers (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('openai', 'anthropic')),
  base_url VARCHAR(512) NOT NULL DEFAULT '',
  api_key_ciphertext TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE model_entries (
  id VARCHAR(36) PRIMARY KEY,
  provider_id VARCHAR(36) NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
  slug VARCHAR(160) NOT NULL,
  label VARCHAR(160) NOT NULL DEFAULT '',
  description VARCHAR(255) NOT NULL DEFAULT '',
  capabilities JSON NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_model_entries_provider_slug UNIQUE (provider_id, slug)
);
CREATE INDEX ix_model_entries_provider_id ON model_entries(provider_id);
CREATE INDEX ix_model_entries_provider_order ON model_entries(provider_id, sort_order);

CREATE TABLE llm_call_logs (
  id VARCHAR(36) PRIMARY KEY,
  call_source VARCHAR(64) NOT NULL,
  provider_kind VARCHAR(24) NOT NULL,
  model VARCHAR(160) NOT NULL,
  trace_id VARCHAR(36) NOT NULL,
  request_payload JSON NOT NULL DEFAULT '{}',
  response_payload JSON NOT NULL DEFAULT '{}',
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL CHECK (status IN ('success', 'error')),
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_llm_call_logs_created_at ON llm_call_logs(created_at DESC);
CREATE INDEX ix_llm_call_logs_model ON llm_call_logs(model);
CREATE INDEX ix_llm_call_logs_provider_kind ON llm_call_logs(provider_kind);
CREATE INDEX ix_llm_call_logs_status ON llm_call_logs(status);
CREATE INDEX ix_llm_call_logs_trace_id ON llm_call_logs(trace_id);
CREATE INDEX ix_llm_call_logs_call_source ON llm_call_logs(call_source);
"""
