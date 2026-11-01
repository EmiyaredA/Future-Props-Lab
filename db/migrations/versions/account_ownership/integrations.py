"""Account ownership for integrations records."""

SQL = """
CREATE TABLE "integration_tool_apis__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  method VARCHAR(8) NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  url VARCHAR(1024) NOT NULL,
  auth_kind VARCHAR(16) NOT NULL DEFAULT 'none' CHECK (auth_kind IN ('none', 'bearer', 'api_key')),
  auth_header_name VARCHAR(120) NOT NULL DEFAULT '',
  secret_ciphertext TEXT NOT NULL DEFAULT '',
  parameters_schema JSON NOT NULL DEFAULT '{}',
  query_template JSON NOT NULL DEFAULT '{}',
  body_template JSON,
  tags JSON NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(16) NOT NULL DEFAULT 'unchecked'
    CHECK (status IN ('unchecked', 'healthy', 'failed')),
  status_message VARCHAR(500) NOT NULL DEFAULT '',
  last_checked_at TIMESTAMP,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, sensitive_result BOOLEAN NOT NULL
    DEFAULT 0,
  UNIQUE (owner_user_id, name)
);
INSERT INTO "integration_tool_apis__account_upgrade" (
    "id",
    "owner_user_id",
    "name",
    "description",
    "method",
    "url",
    "auth_kind",
    "auth_header_name",
    "secret_ciphertext",
    "parameters_schema",
    "query_template",
    "body_template",
    "tags",
    "enabled",
    "status",
    "status_message",
    "last_checked_at",
    "revision",
    "created_at",
    "updated_at",
    "sensitive_result"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    CASE WHEN EXISTS (SELECT 1 FROM "integration_tool_apis" other JOIN _account_owners om ON
    om.source_id=other.workspace_id WHERE om.owner_user_id=(SELECT owner_user_id FROM
    _account_owners WHERE source_id=src.workspace_id) AND other.name=src.name AND other.id<src.id)
    THEN src.name || ' (' || substr(src.workspace_id,1,8) || ')' ELSE src.name END,
    src."description",
    src."method",
    src."url",
    src."auth_kind",
    src."auth_header_name",
    src."secret_ciphertext",
    src."parameters_schema",
    src."query_template",
    src."body_template",
    src."tags",
    src."enabled",
    src."status",
    src."status_message",
    src."last_checked_at",
    src."revision",
    src."created_at",
    src."updated_at",
    src."sensitive_result"
FROM "integration_tool_apis" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "integration_tool_apis";
ALTER TABLE "integration_tool_apis__account_upgrade" RENAME TO "integration_tool_apis";
CREATE INDEX ix_integration_tool_apis_account ON integration_tool_apis(owner_user_id, updated_at);

CREATE TABLE "integration_mcp_servers__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  transport VARCHAR(24) NOT NULL CHECK (transport IN ('streamable_http', 'stdio')),
  url VARCHAR(1024) NOT NULL DEFAULT '',
  command VARCHAR(1024) NOT NULL DEFAULT '',
  arguments JSON NOT NULL DEFAULT '[]',
  bearer_ciphertext TEXT NOT NULL DEFAULT '',
  environment_ciphertext TEXT NOT NULL DEFAULT '',
  environment_keys JSON NOT NULL DEFAULT '[]',
  tags JSON NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(16) NOT NULL DEFAULT 'unchecked'
    CHECK (status IN ('unchecked', 'healthy', 'failed')),
  status_message VARCHAR(500) NOT NULL DEFAULT '',
  server_name VARCHAR(160) NOT NULL DEFAULT '',
  server_version VARCHAR(80) NOT NULL DEFAULT '',
  protocol_version VARCHAR(80) NOT NULL DEFAULT '',
  last_checked_at TIMESTAMP,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, sensitive_result BOOLEAN NOT NULL
    DEFAULT 0,
  UNIQUE (owner_user_id, name)
);
INSERT INTO "integration_mcp_servers__account_upgrade" (
    "id",
    "owner_user_id",
    "name",
    "description",
    "transport",
    "url",
    "command",
    "arguments",
    "bearer_ciphertext",
    "environment_ciphertext",
    "environment_keys",
    "tags",
    "enabled",
    "status",
    "status_message",
    "server_name",
    "server_version",
    "protocol_version",
    "last_checked_at",
    "revision",
    "created_at",
    "updated_at",
    "sensitive_result"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    CASE WHEN EXISTS (SELECT 1 FROM "integration_mcp_servers" other JOIN _account_owners om ON
    om.source_id=other.workspace_id WHERE om.owner_user_id=(SELECT owner_user_id FROM
    _account_owners WHERE source_id=src.workspace_id) AND other.name=src.name AND other.id<src.id)
    THEN src.name || ' (' || substr(src.workspace_id,1,8) || ')' ELSE src.name END,
    src."description",
    src."transport",
    src."url",
    src."command",
    src."arguments",
    src."bearer_ciphertext",
    src."environment_ciphertext",
    src."environment_keys",
    src."tags",
    src."enabled",
    src."status",
    src."status_message",
    src."server_name",
    src."server_version",
    src."protocol_version",
    src."last_checked_at",
    src."revision",
    src."created_at",
    src."updated_at",
    src."sensitive_result"
FROM "integration_mcp_servers" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "integration_mcp_servers";
ALTER TABLE "integration_mcp_servers__account_upgrade" RENAME TO "integration_mcp_servers";
CREATE INDEX ix_integration_mcp_account ON integration_mcp_servers(owner_user_id, updated_at);

CREATE TABLE "integration_checks__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  resource_kind VARCHAR(24) NOT NULL CHECK (resource_kind IN ('tool_api', 'mcp')),
  resource_id VARCHAR(36) NOT NULL,
  resource_name VARCHAR(120) NOT NULL,
  ok BOOLEAN NOT NULL,
  status_code INTEGER,
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  summary VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "integration_checks__account_upgrade" (
    "id",
    "owner_user_id",
    "resource_kind",
    "resource_id",
    "resource_name",
    "ok",
    "status_code",
    "latency_ms",
    "summary",
    "created_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."resource_kind",
    src."resource_id",
    src."resource_name",
    src."ok",
    src."status_code",
    src."latency_ms",
    src."summary",
    src."created_at"
FROM "integration_checks" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "integration_checks";
ALTER TABLE "integration_checks__account_upgrade" RENAME TO "integration_checks";
CREATE INDEX ix_integration_checks_account_kind_created
  ON integration_checks(owner_user_id, resource_kind, created_at);
CREATE INDEX ix_integration_checks_resource
  ON integration_checks(resource_kind, resource_id, created_at);

CREATE TABLE "amadeus_conversations__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 model_id VARCHAR(36),
 revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
, executor_kind VARCHAR(24) NOT NULL DEFAULT 'legacy-pi', agent_id VARCHAR(24));
INSERT INTO "amadeus_conversations__account_upgrade" (
    "id",
    "owner_user_id",
    "user_id",
    "title",
    "model_id",
    "revision",
    "created_at",
    "updated_at",
    "executor_kind",
    "agent_id"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."user_id",
    src."title",
    src."model_id",
    src."revision",
    src."created_at",
    src."updated_at",
    src."executor_kind",
    src."agent_id"
FROM "amadeus_conversations" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "amadeus_conversations";
ALTER TABLE "amadeus_conversations__account_upgrade" RENAME TO "amadeus_conversations";
CREATE INDEX ix_amadeus_conversations_owner_updated
 ON amadeus_conversations(owner_user_id, user_id, updated_at);

CREATE TABLE "amadeus_messages__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 conversation_id VARCHAR(36) NOT NULL REFERENCES amadeus_conversations(id) ON DELETE CASCADE,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 role VARCHAR(16) NOT NULL,
 content TEXT NOT NULL,
 references_json JSON NOT NULL,
 created_at DATETIME NOT NULL
, run_id VARCHAR(36) REFERENCES amadeus_runs(id), status VARCHAR(24) NOT NULL DEFAULT 'completed');
INSERT INTO "amadeus_messages__account_upgrade" (
    "id",
    "conversation_id",
    "owner_user_id",
    "role",
    "content",
    "references_json",
    "created_at",
    "run_id",
    "status"
)
SELECT
    src."id",
    src."conversation_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."role",
    src."content",
    src."references_json",
    src."created_at",
    src."run_id",
    src."status"
FROM "amadeus_messages" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "amadeus_messages";
ALTER TABLE "amadeus_messages__account_upgrade" RENAME TO "amadeus_messages";
CREATE INDEX ix_amadeus_messages_conversation_created
 ON amadeus_messages(conversation_id, created_at);
CREATE INDEX ix_amadeus_messages_run ON amadeus_messages(run_id);

CREATE TABLE "amadeus_actions__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 conversation_id VARCHAR(36) NOT NULL REFERENCES amadeus_conversations(id) ON DELETE CASCADE,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 tool_name VARCHAR(120) NOT NULL,
 arguments_json JSON NOT NULL,
 arguments_sha256 VARCHAR(64) NOT NULL,
 status VARCHAR(24) NOT NULL,
 result_json JSON,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
, run_id VARCHAR(36) REFERENCES amadeus_runs(id));
INSERT INTO "amadeus_actions__account_upgrade" (
    "id",
    "conversation_id",
    "owner_user_id",
    "user_id",
    "tool_name",
    "arguments_json",
    "arguments_sha256",
    "status",
    "result_json",
    "created_at",
    "updated_at",
    "run_id"
)
SELECT
    src."id",
    src."conversation_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."user_id",
    src."tool_name",
    src."arguments_json",
    src."arguments_sha256",
    src."status",
    src."result_json",
    src."created_at",
    src."updated_at",
    src."run_id"
FROM "amadeus_actions" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "amadeus_actions";
ALTER TABLE "amadeus_actions__account_upgrade" RENAME TO "amadeus_actions";
CREATE INDEX ix_amadeus_actions_conversation_created
 ON amadeus_actions(conversation_id, created_at);
CREATE INDEX ix_amadeus_actions_run ON amadeus_actions(run_id);

CREATE TABLE "amadeus_runs__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 conversation_id VARCHAR(36) NOT NULL REFERENCES amadeus_conversations(id) ON DELETE CASCADE,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 model_id VARCHAR(36) NOT NULL,
 status VARCHAR(24) NOT NULL,
 active_owner_key VARCHAR(100) UNIQUE,
 context_json JSON NOT NULL,
 references_json JSON NOT NULL,
 capabilities_json JSON NOT NULL,
 partial_text TEXT NOT NULL DEFAULT '',
 last_event_sequence INTEGER NOT NULL DEFAULT 0,
 heartbeat_at DATETIME NOT NULL,
 error_message TEXT,
 response_message_id VARCHAR(36),
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 finished_at DATETIME
, mode VARCHAR(12) NOT NULL DEFAULT 'agent', source_run_id VARCHAR(36)
 REFERENCES amadeus_runs(id) ON DELETE SET NULL, agent_id VARCHAR(24), agent_model VARCHAR(160) NOT
    NULL DEFAULT '', execution_config JSON NOT NULL DEFAULT '{}');
INSERT INTO "amadeus_runs__account_upgrade" (
    "id",
    "conversation_id",
    "owner_user_id",
    "user_id",
    "model_id",
    "status",
    "active_owner_key",
    "context_json",
    "references_json",
    "capabilities_json",
    "partial_text",
    "last_event_sequence",
    "heartbeat_at",
    "error_message",
    "response_message_id",
    "created_at",
    "updated_at",
    "finished_at",
    "mode",
    "source_run_id",
    "agent_id",
    "agent_model",
    "execution_config"
)
SELECT
    src."id",
    src."conversation_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."user_id",
    src."model_id",
    src."status",
    src."active_owner_key",
    src."context_json",
    src."references_json",
    src."capabilities_json",
    src."partial_text",
    src."last_event_sequence",
    src."heartbeat_at",
    src."error_message",
    src."response_message_id",
    src."created_at",
    src."updated_at",
    src."finished_at",
    src."mode",
    src."source_run_id",
    src."agent_id",
    src."agent_model",
    src."execution_config"
FROM "amadeus_runs" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "amadeus_runs";
ALTER TABLE "amadeus_runs__account_upgrade" RENAME TO "amadeus_runs";
CREATE INDEX ix_amadeus_runs_owner_updated
 ON amadeus_runs(owner_user_id, user_id, updated_at);
CREATE INDEX ix_amadeus_runs_conversation_created
 ON amadeus_runs(conversation_id, created_at);
CREATE UNIQUE INDEX ix_amadeus_runs_source_run_id ON amadeus_runs(source_run_id);

CREATE TABLE "amadeus_run_events__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 run_id VARCHAR(36) NOT NULL REFERENCES amadeus_runs(id) ON DELETE CASCADE,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL,
 kind VARCHAR(40) NOT NULL,
 payload_json JSON NOT NULL,
 idempotency_key VARCHAR(120) NOT NULL,
 created_at DATETIME NOT NULL,
 UNIQUE(run_id, sequence),
 UNIQUE(run_id, idempotency_key)
);
INSERT INTO "amadeus_run_events__account_upgrade" (
    "id",
    "run_id",
    "owner_user_id",
    "sequence",
    "kind",
    "payload_json",
    "idempotency_key",
    "created_at"
)
SELECT
    src."id",
    src."run_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."sequence",
    src."kind",
    src."payload_json",
    src."idempotency_key",
    src."created_at"
FROM "amadeus_run_events" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "amadeus_run_events";
ALTER TABLE "amadeus_run_events__account_upgrade" RENAME TO "amadeus_run_events";
CREATE INDEX ix_amadeus_run_events_run_sequence
 ON amadeus_run_events(run_id, sequence);

CREATE TABLE "amadeus_questions__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 conversation_id VARCHAR(36) NOT NULL REFERENCES amadeus_conversations(id) ON DELETE CASCADE,
 run_id VARCHAR(36) NOT NULL UNIQUE REFERENCES amadeus_runs(id) ON DELETE CASCADE,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 tool_call_id VARCHAR(120) NOT NULL,
 prompt TEXT NOT NULL,
 options_json JSON NOT NULL,
 allow_text BOOLEAN NOT NULL,
 status VARCHAR(16) NOT NULL,
 answer_json JSON,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
INSERT INTO "amadeus_questions__account_upgrade" (
    "id",
    "conversation_id",
    "run_id",
    "owner_user_id",
    "user_id",
    "tool_call_id",
    "prompt",
    "options_json",
    "allow_text",
    "status",
    "answer_json",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    src."conversation_id",
    src."run_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."user_id",
    src."tool_call_id",
    src."prompt",
    src."options_json",
    src."allow_text",
    src."status",
    src."answer_json",
    src."created_at",
    src."updated_at"
FROM "amadeus_questions" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "amadeus_questions";
ALTER TABLE "amadeus_questions__account_upgrade" RENAME TO "amadeus_questions";
CREATE INDEX ix_amadeus_questions_conversation_created
 ON amadeus_questions(conversation_id, created_at);

CREATE TABLE "integration_external_connections__account_upgrade" (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
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
	UNIQUE (owner_user_id, name),
	FOREIGN KEY(owner_user_id) REFERENCES users (id) ON DELETE CASCADE
);
INSERT INTO "integration_external_connections__account_upgrade" (
    "id",
    "owner_user_id",
    "provider",
    "name",
    "app_id",
    "secret_ciphertext",
    "enabled",
    "status",
    "status_message",
    "last_checked_at",
    "revision",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."provider",
    CASE WHEN EXISTS (SELECT 1 FROM "integration_external_connections" other JOIN _account_owners
    om ON om.source_id=other.workspace_id WHERE om.owner_user_id=(SELECT owner_user_id FROM
    _account_owners WHERE source_id=src.workspace_id) AND other.name=src.name AND other.id<src.id)
    THEN src.name || ' (' || substr(src.workspace_id,1,8) || ')' ELSE src.name END,
    src."app_id",
    src."secret_ciphertext",
    src."enabled",
    src."status",
    src."status_message",
    src."last_checked_at",
    src."revision",
    src."created_at",
    src."updated_at"
FROM "integration_external_connections" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "integration_external_connections";
ALTER TABLE "integration_external_connections__account_upgrade" RENAME TO
    "integration_external_connections";
CREATE INDEX ix_integration_external_connections_owner_user_id ON integration_external_connections
    (owner_user_id);

CREATE TABLE "integration_skills__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(4000) NOT NULL DEFAULT '',
  default_version VARCHAR(24) NOT NULL DEFAULT 'v1',
  latest_version VARCHAR(24) NOT NULL DEFAULT 'v1',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16) NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('unchecked', 'healthy', 'failed')),
  status_message VARCHAR(500) NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tags JSON NOT NULL DEFAULT '[]',
  UNIQUE (owner_user_id, name)
);
INSERT INTO "integration_skills__account_upgrade" (
    "id",
    "owner_user_id",
    "name",
    "description",
    "default_version",
    "latest_version",
    "enabled",
    "status",
    "status_message",
    "revision",
    "created_at",
    "updated_at",
    "tags"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    CASE WHEN EXISTS (SELECT 1 FROM "integration_skills" other JOIN _account_owners om ON
    om.source_id=other.workspace_id WHERE om.owner_user_id=(SELECT owner_user_id FROM
    _account_owners WHERE source_id=src.workspace_id) AND other.name=src.name AND other.id<src.id)
    THEN src.name || ' (' || substr(src.workspace_id,1,8) || ')' ELSE src.name END,
    src."description",
    src."default_version",
    src."latest_version",
    src."enabled",
    src."status",
    src."status_message",
    src."revision",
    src."created_at",
    src."updated_at",
    src."tags"
FROM "integration_skills" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "integration_skills";
ALTER TABLE "integration_skills__account_upgrade" RENAME TO "integration_skills";
CREATE INDEX ix_integration_skills_account ON integration_skills(owner_user_id, updated_at);

CREATE TABLE "interview_rooms__account_upgrade" (
        id VARCHAR(36) PRIMARY KEY NOT NULL,
        owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        user_id VARCHAR(36) NOT NULL,
        title VARCHAR(120) NOT NULL,
        revision INTEGER NOT NULL,
        input_version INTEGER NOT NULL,
        active_task_id VARCHAR(36),
        active_bundle_id VARCHAR(36),
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    );
INSERT INTO "interview_rooms__account_upgrade" (
    "id",
    "owner_user_id",
    "user_id",
    "title",
    "revision",
    "input_version",
    "active_task_id",
    "active_bundle_id",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."user_id",
    src."title",
    src."revision",
    src."input_version",
    src."active_task_id",
    src."active_bundle_id",
    src."created_at",
    src."updated_at"
FROM "interview_rooms" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "interview_rooms";
ALTER TABLE "interview_rooms__account_upgrade" RENAME TO "interview_rooms";
CREATE INDEX ix_interview_rooms_owner_user_id ON interview_rooms(owner_user_id);
CREATE INDEX ix_interview_rooms_user_id ON interview_rooms(user_id);

CREATE TABLE "interview_preparations__account_upgrade" (
        id VARCHAR(36) PRIMARY KEY NOT NULL,
        owner_user_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        room_id VARCHAR(36) NOT NULL REFERENCES interview_rooms(id) ON DELETE CASCADE,
        request_id VARCHAR(100) NOT NULL,
        fingerprint VARCHAR(64) NOT NULL,
        input_hash VARCHAR(64) NOT NULL,
        input_version INTEGER NOT NULL,
        snapshot JSON NOT NULL,
        status VARCHAR(24) NOT NULL,
        revision INTEGER NOT NULL,
        events JSON NOT NULL,
        result JSON,
        message VARCHAR(1000) NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE(room_id, request_id)
    );
INSERT INTO "interview_preparations__account_upgrade" (
    "id",
    "owner_user_id",
    "user_id",
    "room_id",
    "request_id",
    "fingerprint",
    "input_hash",
    "input_version",
    "snapshot",
    "status",
    "revision",
    "events",
    "result",
    "message",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."user_id",
    src."room_id",
    src."request_id",
    src."fingerprint",
    src."input_hash",
    src."input_version",
    src."snapshot",
    src."status",
    src."revision",
    src."events",
    src."result",
    src."message",
    src."created_at",
    src."updated_at"
FROM "interview_preparations" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "interview_preparations";
ALTER TABLE "interview_preparations__account_upgrade" RENAME TO "interview_preparations";
CREATE INDEX ix_interview_preparations_owner_user_id ON interview_preparations(owner_user_id);
CREATE INDEX ix_interview_preparations_room_id ON interview_preparations(room_id);
"""
