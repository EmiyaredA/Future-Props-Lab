MIGRATION_ID = "r0031_integration_center"

SQL = r"""
CREATE TABLE integration_tool_apis (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
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
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, name)
);
CREATE INDEX ix_integration_tool_apis_workspace ON integration_tool_apis(workspace_id, updated_at);

CREATE TABLE integration_mcp_servers (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
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
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, name)
);
CREATE INDEX ix_integration_mcp_workspace ON integration_mcp_servers(workspace_id, updated_at);

CREATE TABLE integration_mcp_tools (
  id VARCHAR(36) PRIMARY KEY,
  server_id VARCHAR(36) NOT NULL REFERENCES integration_mcp_servers(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  input_schema JSON NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (server_id, name)
);
CREATE INDEX ix_integration_mcp_tools_server ON integration_mcp_tools(server_id, name);

CREATE TABLE integration_skills (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  default_version VARCHAR(24) NOT NULL DEFAULT 'v1',
  latest_version VARCHAR(24) NOT NULL DEFAULT 'v1',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16) NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('unchecked', 'healthy', 'failed')),
  status_message VARCHAR(500) NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, name)
);
CREATE INDEX ix_integration_skills_workspace ON integration_skills(workspace_id, updated_at);

CREATE TABLE integration_skill_versions (
  id VARCHAR(36) PRIMARY KEY,
  skill_id VARCHAR(36) NOT NULL REFERENCES integration_skills(id) ON DELETE CASCADE,
  version VARCHAR(24) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  storage_path VARCHAR(1024) NOT NULL,
  content_sha256 VARCHAR(64) NOT NULL,
  file_count INTEGER NOT NULL CHECK (file_count >= 1),
  expanded_bytes INTEGER NOT NULL CHECK (expanded_bytes >= 1),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (skill_id, version)
);
CREATE INDEX ix_integration_skill_versions_skill
  ON integration_skill_versions(skill_id, created_at);

CREATE TABLE integration_checks (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  resource_kind VARCHAR(24) NOT NULL CHECK (resource_kind IN ('tool_api', 'mcp')),
  resource_id VARCHAR(36) NOT NULL,
  resource_name VARCHAR(120) NOT NULL,
  ok BOOLEAN NOT NULL,
  status_code INTEGER,
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  summary VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_integration_checks_workspace_kind_created
  ON integration_checks(workspace_id, resource_kind, created_at);
CREATE INDEX ix_integration_checks_resource
  ON integration_checks(resource_kind, resource_id, created_at);
"""
