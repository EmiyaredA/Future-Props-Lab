"""Account ownership for models records."""

SQL = """
CREATE TABLE "model_catalog_state__account_upgrade" (
  id VARCHAR(32) PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "model_catalog_state__account_upgrade" (
    "id",
    "revision",
    "updated_at"
)
SELECT
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."id"),
    src."revision",
    src."updated_at"
FROM "model_catalog_state" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."id") IS NOT NULL AND src.id = (SELECT source_id FROM _account_owners WHERE
    owner_user_id=(SELECT owner_user_id FROM _account_owners WHERE source_id=src.id) ORDER BY
    ordinal LIMIT 1);
DROP TABLE "model_catalog_state";
ALTER TABLE "model_catalog_state__account_upgrade" RENAME TO "model_catalog_state";

CREATE TABLE "model_entries__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  provider_id VARCHAR(36) NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
  slug VARCHAR(160) NOT NULL,
  label VARCHAR(160) NOT NULL DEFAULT '',
  description VARCHAR(255) NOT NULL DEFAULT '',
  capabilities JSON NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, categories JSON NOT NULL DEFAULT '[]',
    owner_user_id VARCHAR(36) NOT NULL, origin VARCHAR(20) NOT NULL DEFAULT 'user', template_key
    VARCHAR(100),
  CONSTRAINT uq_model_entries_provider_slug UNIQUE (provider_id, slug)
);
INSERT INTO "model_entries__account_upgrade" (
    "id",
    "provider_id",
    "slug",
    "label",
    "description",
    "capabilities",
    "enabled",
    "sort_order",
    "created_at",
    "updated_at",
    "categories",
    "owner_user_id",
    "origin",
    "template_key"
)
SELECT
    src."id",
    src."provider_id",
    src."slug",
    src."label",
    src."description",
    src."capabilities",
    src."enabled",
    src."sort_order",
    src."created_at",
    src."updated_at",
    src."categories",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."origin",
    CASE WHEN EXISTS (SELECT 1 FROM "model_entries" other JOIN _account_owners om ON
    om.source_id=other.workspace_id WHERE om.owner_user_id=(SELECT owner_user_id FROM
    _account_owners WHERE source_id=src.workspace_id) AND other.template_key=src.template_key AND
    other.id<src.id) THEN NULL ELSE src.template_key END
FROM "model_entries" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_entries";
ALTER TABLE "model_entries__account_upgrade" RENAME TO "model_entries";
CREATE INDEX ix_model_entries_provider_id ON model_entries(provider_id);
CREATE INDEX ix_model_entries_provider_order ON model_entries(provider_id, sort_order);
CREATE INDEX ix_model_entries_account ON model_entries(owner_user_id, provider_id, sort_order);
CREATE UNIQUE INDEX uq_model_template ON model_entries(owner_user_id, template_key);

CREATE TABLE "llm_call_logs__account_upgrade" (
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
, owner_user_id VARCHAR(36) NOT NULL, auth_kind VARCHAR(32), api_key_id VARCHAR(36), api_key_name
    VARCHAR(64), api_key_prefix VARCHAR(16));
INSERT INTO "llm_call_logs__account_upgrade" (
    "id",
    "call_source",
    "provider_kind",
    "model",
    "trace_id",
    "request_payload",
    "response_payload",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "latency_ms",
    "status",
    "error_message",
    "created_at",
    "owner_user_id",
    "auth_kind",
    "api_key_id",
    "api_key_name",
    "api_key_prefix"
)
SELECT
    src."id",
    src."call_source",
    src."provider_kind",
    src."model",
    src."trace_id",
    src."request_payload",
    src."response_payload",
    src."prompt_tokens",
    src."completion_tokens",
    src."total_tokens",
    src."latency_ms",
    src."status",
    src."error_message",
    src."created_at",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."auth_kind",
    src."api_key_id",
    src."api_key_name",
    src."api_key_prefix"
FROM "llm_call_logs" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "llm_call_logs";
ALTER TABLE "llm_call_logs__account_upgrade" RENAME TO "llm_call_logs";
CREATE INDEX ix_llm_call_logs_created_at ON llm_call_logs(created_at DESC);
CREATE INDEX ix_llm_call_logs_model ON llm_call_logs(model);
CREATE INDEX ix_llm_call_logs_provider_kind ON llm_call_logs(provider_kind);
CREATE INDEX ix_llm_call_logs_status ON llm_call_logs(status);
CREATE INDEX ix_llm_call_logs_trace_id ON llm_call_logs(trace_id);
CREATE INDEX ix_llm_call_logs_call_source ON llm_call_logs(call_source);
CREATE INDEX ix_llm_call_logs_account_created ON llm_call_logs(owner_user_id, created_at DESC);
CREATE INDEX ix_llm_call_logs_api_key_id ON llm_call_logs(api_key_id);
CREATE INDEX ix_llm_call_logs_auth_kind ON llm_call_logs(auth_kind);

CREATE TABLE "model_test_conversations__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(120) NOT NULL DEFAULT '新对话',
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  temperature REAL NOT NULL DEFAULT 0.7 CHECK (temperature >= 0 AND temperature <= 2),
  max_tokens INTEGER NOT NULL DEFAULT 1024 CHECK (max_tokens >= 1 AND max_tokens <= 8192),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, owner_user_id VARCHAR(36) NOT NULL);
INSERT INTO "model_test_conversations__account_upgrade" (
    "id",
    "title",
    "model_id",
    "system_prompt",
    "temperature",
    "max_tokens",
    "revision",
    "created_at",
    "updated_at",
    "owner_user_id"
)
SELECT
    src."id",
    src."title",
    src."model_id",
    src."system_prompt",
    src."temperature",
    src."max_tokens",
    src."revision",
    src."created_at",
    src."updated_at",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id")
FROM "model_test_conversations" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_test_conversations";
ALTER TABLE "model_test_conversations__account_upgrade" RENAME TO "model_test_conversations";
CREATE INDEX ix_model_test_conversations_updated_at
  ON model_test_conversations(updated_at DESC);
CREATE INDEX ix_model_test_conversations_model_id
  ON model_test_conversations(model_id);
CREATE INDEX ix_model_test_conversations_workspace
  ON model_test_conversations(owner_user_id, updated_at DESC);

CREATE TABLE "model_test_generation_assets__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  task_id VARCHAR(36)
    REFERENCES model_test_generation_tasks(id) ON DELETE CASCADE,
  role VARCHAR(24) CHECK (
    role IS NULL OR role IN ('reference_image', 'reference_audio', 'reference_video')
  ),
  position INTEGER CHECK (position IS NULL OR position >= 0),
  original_filename VARCHAR(255) NOT NULL,
  storage_key VARCHAR(64) NOT NULL UNIQUE,
  media_kind VARCHAR(16) NOT NULL CHECK (media_kind IN ('image', 'audio', 'video')),
  mime_type VARCHAR(120) NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  legacy_visual_asset_id VARCHAR(36),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, owner_user_id VARCHAR(36) NOT NULL,
  CHECK (
    (task_id IS NULL AND role IS NULL AND position IS NULL)
    OR (task_id IS NOT NULL AND role IS NOT NULL AND position IS NOT NULL)
  ),
  UNIQUE (task_id, role, position)
);
INSERT INTO "model_test_generation_assets__account_upgrade" (
    "id",
    "task_id",
    "role",
    "position",
    "original_filename",
    "storage_key",
    "media_kind",
    "mime_type",
    "byte_size",
    "legacy_visual_asset_id",
    "created_at",
    "owner_user_id"
)
SELECT
    src."id",
    src."task_id",
    src."role",
    src."position",
    src."original_filename",
    src."storage_key",
    src."media_kind",
    src."mime_type",
    src."byte_size",
    src."legacy_visual_asset_id",
    src."created_at",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id")
FROM "model_test_generation_assets" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_test_generation_assets";
ALTER TABLE "model_test_generation_assets__account_upgrade" RENAME TO
    "model_test_generation_assets";
CREATE INDEX ix_model_test_generation_assets_task
  ON model_test_generation_assets(task_id, role, position);
CREATE INDEX ix_model_test_generation_assets_draft_created
  ON model_test_generation_assets(created_at) WHERE task_id IS NULL;

CREATE TABLE "model_test_tools__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  input_schema JSON NOT NULL DEFAULT '{"type":"object","properties":{}}',
  mock_kind VARCHAR(16) NOT NULL DEFAULT 'success' CHECK (mock_kind IN ('success', 'failure')),
  mock_result JSON,
  error_code VARCHAR(120) NOT NULL DEFAULT '',
  error_message VARCHAR(1000) NOT NULL DEFAULT '',
  delay_ms INTEGER NOT NULL DEFAULT 0 CHECK (delay_ms >= 0 AND delay_ms <= 10000),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_user_id, name)
);
INSERT INTO "model_test_tools__account_upgrade" (
    "id",
    "owner_user_id",
    "name",
    "description",
    "input_schema",
    "mock_kind",
    "mock_result",
    "error_code",
    "error_message",
    "delay_ms",
    "enabled",
    "revision",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    CASE WHEN EXISTS (SELECT 1 FROM "model_test_tools" other JOIN _account_owners om ON
    om.source_id=other.workspace_id WHERE om.owner_user_id=(SELECT owner_user_id FROM
    _account_owners WHERE source_id=src.workspace_id) AND other.name=src.name AND other.id<src.id)
    THEN src.name || ' (' || substr(src.workspace_id,1,8) || ')' ELSE src.name END,
    src."description",
    src."input_schema",
    src."mock_kind",
    src."mock_result",
    src."error_code",
    src."error_message",
    src."delay_ms",
    src."enabled",
    src."revision",
    src."created_at",
    src."updated_at"
FROM "model_test_tools" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_test_tools";
ALTER TABLE "model_test_tools__account_upgrade" RENAME TO "model_test_tools";
CREATE INDEX ix_model_test_tools_account_updated
  ON model_test_tools(owner_user_id, updated_at);

CREATE TABLE "model_test_tool_calls__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tool_id VARCHAR(36) REFERENCES model_test_tools(id) ON DELETE SET NULL,
  conversation_id VARCHAR(36) REFERENCES model_test_conversations(id) ON DELETE SET NULL,
  message_id VARCHAR(36) REFERENCES model_test_messages(id) ON DELETE SET NULL,
  source VARCHAR(16) NOT NULL CHECK (source IN ('dry_run', 'model_test', 'realtime_voice')),
  action_id VARCHAR(160) NOT NULL DEFAULT '',
  run_id VARCHAR(36) NOT NULL DEFAULT '',
  round_index INTEGER NOT NULL DEFAULT 0 CHECK (round_index >= 0),
  tool_name VARCHAR(64) NOT NULL,
  tool_revision INTEGER NOT NULL DEFAULT 0 CHECK (tool_revision >= 0),
  definition_snapshot JSON NOT NULL DEFAULT '{}',
  arguments JSON NOT NULL DEFAULT '{}',
  status VARCHAR(16) NOT NULL CHECK (status IN ('proposed', 'running', 'completed', 'failed',
    'cancelled')),
  success BOOLEAN,
  result JSON,
  error_code VARCHAR(120) NOT NULL DEFAULT '',
  error_message VARCHAR(1000) NOT NULL DEFAULT '',
  configured_delay_ms INTEGER NOT NULL DEFAULT 0 CHECK (configured_delay_ms >= 0),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (message_id, action_id)
);
INSERT INTO "model_test_tool_calls__account_upgrade" (
    "id",
    "owner_user_id",
    "tool_id",
    "conversation_id",
    "message_id",
    "source",
    "action_id",
    "run_id",
    "round_index",
    "tool_name",
    "tool_revision",
    "definition_snapshot",
    "arguments",
    "status",
    "success",
    "result",
    "error_code",
    "error_message",
    "configured_delay_ms",
    "duration_ms",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."tool_id",
    src."conversation_id",
    src."message_id",
    src."source",
    src."action_id",
    src."run_id",
    src."round_index",
    src."tool_name",
    src."tool_revision",
    src."definition_snapshot",
    src."arguments",
    src."status",
    src."success",
    src."result",
    src."error_code",
    src."error_message",
    src."configured_delay_ms",
    src."duration_ms",
    src."created_at",
    src."updated_at"
FROM "model_test_tool_calls" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_test_tool_calls";
ALTER TABLE "model_test_tool_calls__account_upgrade" RENAME TO "model_test_tool_calls";
CREATE INDEX ix_model_test_tool_calls_account_created
  ON model_test_tool_calls(owner_user_id, created_at);
CREATE INDEX ix_model_test_tool_calls_tool_created
  ON model_test_tool_calls(tool_id, created_at);
CREATE INDEX ix_model_test_tool_calls_message
  ON model_test_tool_calls(message_id, created_at);

CREATE TABLE "model_suppliers__account_upgrade" (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    origin VARCHAR(24) NOT NULL DEFAULT 'user',
    template_key VARCHAR(160),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_user_id, template_key)
);
INSERT INTO "model_suppliers__account_upgrade" (
    "id",
    "owner_user_id",
    "name",
    "sort_order",
    "origin",
    "template_key",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    CASE WHEN EXISTS (SELECT 1 FROM "model_suppliers" other JOIN _account_owners om ON
    om.source_id=other.workspace_id WHERE om.owner_user_id=(SELECT owner_user_id FROM
    _account_owners WHERE source_id=src.workspace_id) AND other.name=src.name AND other.id<src.id)
    THEN src.name || ' (' || substr(src.workspace_id,1,8) || ')' ELSE src.name END,
    src."sort_order",
    src."origin",
    CASE WHEN EXISTS (SELECT 1 FROM "model_suppliers" other JOIN _account_owners om ON
    om.source_id=other.workspace_id WHERE om.owner_user_id=(SELECT owner_user_id FROM
    _account_owners WHERE source_id=src.workspace_id) AND other.template_key=src.template_key AND
    other.id<src.id) THEN NULL ELSE src.template_key END,
    src."created_at",
    src."updated_at"
FROM "model_suppliers" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_suppliers";
ALTER TABLE "model_suppliers__account_upgrade" RENAME TO "model_suppliers";
CREATE INDEX ix_model_suppliers_owner_user_id ON model_suppliers (owner_user_id);

CREATE TABLE "model_inference_tasks__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY NOT NULL,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
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
 created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, auth_kind VARCHAR(32), api_key_id
    VARCHAR(36), api_key_name VARCHAR(64), api_key_prefix VARCHAR(16), execution_info JSON,
 UNIQUE(owner_user_id, request_id)
);
INSERT INTO "model_inference_tasks__account_upgrade" (
    "id",
    "owner_user_id",
    "request_id",
    "fingerprint",
    "provider_id",
    "model_id",
    "provider_kind",
    "provider_name",
    "model_slug",
    "kind",
    "request_payload",
    "status",
    "progress",
    "provider_task_id",
    "result_url",
    "result_storage_key",
    "result_filename",
    "result_mime_type",
    "result_byte_size",
    "result",
    "error_message",
    "log_id",
    "revision",
    "created_at",
    "updated_at",
    "auth_kind",
    "api_key_id",
    "api_key_name",
    "api_key_prefix",
    "execution_info"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."request_id" || ':' || src.workspace_id,
    src."fingerprint",
    src."provider_id",
    src."model_id",
    src."provider_kind",
    src."provider_name",
    src."model_slug",
    src."kind",
    src."request_payload",
    src."status",
    src."progress",
    src."provider_task_id",
    src."result_url",
    src."result_storage_key",
    src."result_filename",
    src."result_mime_type",
    src."result_byte_size",
    src."result",
    src."error_message",
    src."log_id",
    src."revision",
    src."created_at",
    src."updated_at",
    src."auth_kind",
    src."api_key_id",
    src."api_key_name",
    src."api_key_prefix",
    src."execution_info"
FROM "model_inference_tasks" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_inference_tasks";
ALTER TABLE "model_inference_tasks__account_upgrade" RENAME TO "model_inference_tasks";
CREATE INDEX ix_model_inference_tasks_account_status ON model_inference_tasks(owner_user_id,
    status);

CREATE TABLE "model_inference_assets__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY NOT NULL,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 task_id VARCHAR(36) REFERENCES model_inference_tasks(id) ON DELETE CASCADE,
 storage_key VARCHAR(64) NOT NULL, filename VARCHAR(255) NOT NULL,
 mime_type VARCHAR(120) NOT NULL, media_kind VARCHAR(24) NOT NULL,
 byte_size INTEGER NOT NULL, created_at DATETIME NOT NULL
);
INSERT INTO "model_inference_assets__account_upgrade" (
    "id",
    "owner_user_id",
    "task_id",
    "storage_key",
    "filename",
    "mime_type",
    "media_kind",
    "byte_size",
    "created_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."task_id",
    src."storage_key",
    src."filename",
    src."mime_type",
    src."media_kind",
    src."byte_size",
    src."created_at"
FROM "model_inference_assets" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_inference_assets";
ALTER TABLE "model_inference_assets__account_upgrade" RENAME TO "model_inference_assets";
CREATE INDEX ix_model_inference_assets_owner_user_id ON model_inference_assets(owner_user_id);
CREATE INDEX ix_model_inference_assets_task_id ON model_inference_assets(task_id);

CREATE TABLE "model_test_transcription_tasks__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,
  provider_id VARCHAR(36) REFERENCES model_providers(id) ON DELETE SET NULL,
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  provider_kind VARCHAR(24) NOT NULL
    CHECK (provider_kind IN ('openai', 'senseaudio_asr', 'senseaudio_asr_pro')),
  provider_name VARCHAR(120) NOT NULL,
  model_slug VARCHAR(160) NOT NULL,
  source_kind VARCHAR(16) NOT NULL CHECK (source_kind IN ('upload', 'library')),
  source_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  input_storage_key VARCHAR(64) NOT NULL UNIQUE,
  input_filename VARCHAR(255) NOT NULL,
  input_mime_type VARCHAR(120) NOT NULL,
  input_byte_size INTEGER NOT NULL
    CHECK (input_byte_size > 0 AND input_byte_size <= 104857600),
  language VARCHAR(128) NOT NULL DEFAULT 'auto',
  request_options JSON NOT NULL DEFAULT '{}',
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  result_text TEXT,
  result_segments JSON NOT NULL DEFAULT '[]',
  result_detail JSON NOT NULL DEFAULT '{}',
  error_message TEXT,
  log_id VARCHAR(36) REFERENCES llm_call_logs(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
, auth_kind VARCHAR(32), api_key_id VARCHAR(36), api_key_name VARCHAR(64), api_key_prefix
    VARCHAR(16));
INSERT INTO "model_test_transcription_tasks__account_upgrade" (
    "id",
    "owner_user_id",
    "provider_id",
    "model_id",
    "provider_kind",
    "provider_name",
    "model_slug",
    "source_kind",
    "source_asset_id",
    "input_storage_key",
    "input_filename",
    "input_mime_type",
    "input_byte_size",
    "language",
    "request_options",
    "status",
    "result_text",
    "result_segments",
    "result_detail",
    "error_message",
    "log_id",
    "revision",
    "created_at",
    "updated_at",
    "started_at",
    "completed_at",
    "auth_kind",
    "api_key_id",
    "api_key_name",
    "api_key_prefix"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."provider_id",
    src."model_id",
    src."provider_kind",
    src."provider_name",
    src."model_slug",
    src."source_kind",
    src."source_asset_id",
    src."input_storage_key",
    src."input_filename",
    src."input_mime_type",
    src."input_byte_size",
    src."language",
    src."request_options",
    src."status",
    src."result_text",
    src."result_segments",
    src."result_detail",
    src."error_message",
    src."log_id",
    src."revision",
    src."created_at",
    src."updated_at",
    src."started_at",
    src."completed_at",
    src."auth_kind",
    src."api_key_id",
    src."api_key_name",
    src."api_key_prefix"
FROM "model_test_transcription_tasks" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_test_transcription_tasks";
ALTER TABLE "model_test_transcription_tasks__account_upgrade" RENAME TO
    "model_test_transcription_tasks";
CREATE INDEX ix_model_test_transcription_account_created
  ON model_test_transcription_tasks(owner_user_id, created_at DESC);
CREATE INDEX ix_model_test_transcription_status_created
  ON model_test_transcription_tasks(status, created_at);
CREATE INDEX ix_model_test_transcription_model_created
  ON model_test_transcription_tasks(model_id, created_at DESC);

CREATE TABLE "model_providers__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL,
  origin VARCHAR(20) NOT NULL DEFAULT 'user',
  template_key VARCHAR(100),
  name VARCHAR(120) NOT NULL,
  supplier_id VARCHAR(36) REFERENCES model_suppliers(id) ON DELETE RESTRICT,
  kind VARCHAR(24) NOT NULL CHECK (
    kind IN (
      'openai', 'deepseek', 'anthropic', 'senseaudio_image', 'volcengine_image', 'senseaudio_video'
    ,
      'volcengine_video', 'zealman_video', 'autodl_video',
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
INSERT INTO "model_providers__account_upgrade" (
    "id",
    "owner_user_id",
    "origin",
    "template_key",
    "name",
    "supplier_id",
    "kind",
    "base_url",
    "api_key_ciphertext",
    "enabled",
    "sort_order",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."origin",
    CASE WHEN EXISTS (SELECT 1 FROM "model_providers" other JOIN _account_owners om ON
    om.source_id=other.workspace_id WHERE om.owner_user_id=(SELECT owner_user_id FROM
    _account_owners WHERE source_id=src.workspace_id) AND other.template_key=src.template_key AND
    other.id<src.id) THEN NULL ELSE src.template_key END,
    src."name",
    src."supplier_id",
    src."kind",
    src."base_url",
    src."api_key_ciphertext",
    src."enabled",
    src."sort_order",
    src."created_at",
    src."updated_at"
FROM "model_providers" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_providers";
ALTER TABLE "model_providers__account_upgrade" RENAME TO "model_providers";
CREATE INDEX ix_model_providers_account ON model_providers(owner_user_id, sort_order);
CREATE INDEX ix_model_providers_supplier_id ON model_providers(supplier_id);
CREATE UNIQUE INDEX uq_provider_template ON model_providers(owner_user_id, template_key);

CREATE TABLE "model_test_generation_tasks__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  provider_id VARCHAR(36)
    REFERENCES model_providers(id) ON DELETE SET NULL,
  model_id VARCHAR(36)
    REFERENCES model_entries(id) ON DELETE SET NULL,
  provider_kind VARCHAR(24) NOT NULL CHECK (
    provider_kind IN ('senseaudio_image', 'volcengine_image', 'senseaudio_video',
'volcengine_video', 'zealman_video', 'autodl_video')
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
, owner_user_id VARCHAR(36) NOT NULL, auth_kind VARCHAR(32), api_key_id
VARCHAR(36), api_key_name VARCHAR(64), api_key_prefix VARCHAR(16), execution_info JSON);
INSERT INTO "model_test_generation_tasks__account_upgrade" (
    "id",
    "provider_id",
    "model_id",
    "provider_kind",
    "generation_kind",
    "provider_name",
    "model_slug",
    "request_payload",
    "provider_task_id",
    "status",
    "progress",
    "error_message",
    "result_url",
    "result_storage_key",
    "result_filename",
    "result_mime_type",
    "result_byte_size",
    "log_id",
    "revision",
    "created_at",
    "updated_at",
    "completed_at",
    "owner_user_id",
    "auth_kind",
    "api_key_id",
    "api_key_name",
    "api_key_prefix",
    "execution_info"
)
SELECT
    src."id",
    src."provider_id",
    src."model_id",
    src."provider_kind",
    src."generation_kind",
    src."provider_name",
    src."model_slug",
    src."request_payload",
    src."provider_task_id",
    src."status",
    src."progress",
    src."error_message",
    src."result_url",
    src."result_storage_key",
    src."result_filename",
    src."result_mime_type",
    src."result_byte_size",
    src."log_id",
    src."revision",
    src."created_at",
    src."updated_at",
    src."completed_at",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."auth_kind",
    src."api_key_id",
    src."api_key_name",
    src."api_key_prefix",
    src."execution_info"
FROM "model_test_generation_tasks" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_test_generation_tasks";
ALTER TABLE "model_test_generation_tasks__account_upgrade" RENAME TO "model_test_generation_tasks";
CREATE INDEX ix_model_test_generation_status_updated
  ON model_test_generation_tasks(status, updated_at);
CREATE INDEX ix_model_test_generation_model_created
  ON model_test_generation_tasks(model_id, created_at DESC);
CREATE INDEX ix_model_test_generation_workspace
  ON model_test_generation_tasks(owner_user_id, updated_at DESC);
"""
