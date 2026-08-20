# ruff: noqa: E501 -- migration SQL stays one statement per line for reviewability.

MIGRATION_ID = "r0020_accounts_and_workspaces"

SQL = r"""
CREATE TABLE workspaces (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  visibility VARCHAR(16) NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO workspaces (id, name) VALUES ('default', '未来道具研究所');

CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  username_normalized VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL DEFAULT '',
  email VARCHAR(254),
  email_normalized VARCHAR(254),
  avatar_relative_path VARCHAR(512) NOT NULL DEFAULT '',
  avatar_content_type VARCHAR(64) NOT NULL DEFAULT '',
  avatar_content_sha256 VARCHAR(64) NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uq_users_email_normalized
  ON users(email_normalized) WHERE email_normalized IS NOT NULL;
CREATE INDEX ix_users_status ON users(status);
CREATE INDEX ix_users_is_platform_admin ON users(is_platform_admin);

CREATE TABLE workspace_memberships (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('owner', 'member')),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, workspace_id)
);
CREATE UNIQUE INDEX uq_workspace_membership_active_owner
  ON workspace_memberships(workspace_id)
  WHERE role = 'owner' AND status = 'active';
CREATE INDEX ix_workspace_memberships_user_status
  ON workspace_memberships(user_id, status);

CREATE TABLE auth_sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  csrf_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  idle_expires_at TIMESTAMP NOT NULL,
  absolute_expires_at TIMESTAMP NOT NULL,
  reauthenticated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP,
  client_ip VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(500) NOT NULL DEFAULT ''
);
CREATE INDEX ix_auth_sessions_user_active
  ON auth_sessions(user_id, revoked_at, absolute_expires_at);
CREATE INDEX ix_auth_sessions_token_hash ON auth_sessions(token_hash);

CREATE TABLE workspace_invitations (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invitee_user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at TIMESTAMP NOT NULL,
  responded_at TIMESTAMP,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uq_workspace_invitation_pending
  ON workspace_invitations(workspace_id, invitee_user_id) WHERE status = 'pending';
CREATE INDEX ix_workspace_invitations_invitee_status
  ON workspace_invitations(invitee_user_id, status);

CREATE TABLE management_api_keys (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(64) NOT NULL,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  key_prefix VARCHAR(16) NOT NULL,
  scopes JSON NOT NULL DEFAULT '[]',
  expires_at TIMESTAMP NOT NULL,
  last_used_at TIMESTAMP,
  revoked_at TIMESTAMP,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_management_api_keys_workspace_user
  ON management_api_keys(workspace_id, user_id, revoked_at);

CREATE TABLE security_audit_events (
  id VARCHAR(36) PRIMARY KEY,
  actor_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  target_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  workspace_id VARCHAR(36) REFERENCES workspaces(id) ON DELETE SET NULL,
  event_type VARCHAR(64) NOT NULL,
  outcome VARCHAR(16) NOT NULL DEFAULT 'success',
  client_ip VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(500) NOT NULL DEFAULT '',
  metadata_json JSON NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_security_audit_created ON security_audit_events(created_at DESC, id);
CREATE INDEX ix_security_audit_actor ON security_audit_events(actor_user_id, created_at DESC);
CREATE INDEX ix_security_audit_workspace ON security_audit_events(workspace_id, created_at DESC);

ALTER TABLE model_providers ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE model_entries ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE llm_call_logs ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE visual_workshop_projects ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE visual_generation_tasks ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE visual_assistant_conversations ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE galgame_workshop_projects ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE galgame_asset_transcription_tasks ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE visual_asset_folders ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE visual_assets ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE visual_project_asset_references ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE model_test_conversations ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE model_test_generation_tasks ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE model_test_generation_assets ADD COLUMN workspace_id VARCHAR(36) NOT NULL DEFAULT 'default';

CREATE INDEX ix_model_providers_workspace ON model_providers(workspace_id, sort_order);
CREATE INDEX ix_model_entries_workspace ON model_entries(workspace_id, provider_id, sort_order);
CREATE INDEX ix_llm_call_logs_workspace_created ON llm_call_logs(workspace_id, created_at DESC);
CREATE INDEX ix_visual_projects_workspace_updated
  ON visual_workshop_projects(workspace_id, updated_at DESC);
CREATE INDEX ix_galgame_projects_workspace_updated
  ON galgame_workshop_projects(workspace_id, updated_at DESC);
CREATE INDEX ix_visual_assets_workspace_updated ON visual_assets(workspace_id, updated_at DESC);
CREATE INDEX ix_visual_folders_workspace ON visual_asset_folders(workspace_id, project_id, parent_id);
CREATE INDEX ix_model_test_conversations_workspace
  ON model_test_conversations(workspace_id, updated_at DESC);
CREATE INDEX ix_model_test_generation_workspace
  ON model_test_generation_tasks(workspace_id, updated_at DESC);

ALTER TABLE tool_navigation_items RENAME TO tool_navigation_items_r0020_old;
CREATE TABLE tool_navigation_items (
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default',
  tool_id VARCHAR(64) NOT NULL,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  favorite_updated_at TIMESTAMP,
  last_used_at TIMESTAMP,
  use_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, tool_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
INSERT INTO tool_navigation_items (
  workspace_id, tool_id, is_favorite, favorite_updated_at, last_used_at, use_count, updated_at
)
SELECT 'default', tool_id, is_favorite, favorite_updated_at, last_used_at, use_count, updated_at
FROM tool_navigation_items_r0020_old;
DROP TABLE tool_navigation_items_r0020_old;
CREATE INDEX ix_tool_navigation_workspace_last_used
  ON tool_navigation_items(workspace_id, last_used_at DESC);
"""
