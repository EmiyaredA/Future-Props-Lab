"""Account ownership for identity records."""

SQL = """
CREATE TABLE "users__account_upgrade" (
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
, platform_role VARCHAR(16) NOT NULL DEFAULT 'user'
 CHECK (platform_role IN ('admin','user')));
INSERT INTO "users__account_upgrade" (
    "id",
    "username",
    "username_normalized",
    "display_name",
    "email",
    "email_normalized",
    "avatar_relative_path",
    "avatar_content_type",
    "avatar_content_sha256",
    "password_hash",
    "status",
    "is_platform_admin",
    "must_change_password",
    "revision",
    "last_login_at",
    "created_at",
    "updated_at",
    "platform_role"
)
SELECT
    src."id",
    src."username",
    src."username_normalized",
    src."display_name",
    src."email",
    src."email_normalized",
    src."avatar_relative_path",
    src."avatar_content_type",
    src."avatar_content_sha256",
    src."password_hash",
    src."status",
    CASE WHEN src.platform_role IN ('admin','super_admin') THEN 1 ELSE 0 END,
    src."must_change_password",
    src."revision",
    src."last_login_at",
    src."created_at",
    src."updated_at",
    CASE WHEN src.platform_role IN ('admin','super_admin') THEN 'admin' ELSE 'user' END
FROM "users" src;
DROP TABLE "users";
ALTER TABLE "users__account_upgrade" RENAME TO "users";
CREATE UNIQUE INDEX uq_users_email_normalized
  ON users(email_normalized) WHERE email_normalized IS NOT NULL;
CREATE INDEX ix_users_status ON users(status);
CREATE INDEX ix_users_is_platform_admin ON users(is_platform_admin);
CREATE INDEX ix_users_platform_role ON users(platform_role);

CREATE TABLE "auth_sessions__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
INSERT INTO "auth_sessions__account_upgrade" (
    "id",
    "user_id",
    "token_hash",
    "csrf_hash",
    "created_at",
    "last_seen_at",
    "idle_expires_at",
    "absolute_expires_at",
    "reauthenticated_at",
    "revoked_at",
    "client_ip",
    "user_agent"
)
SELECT
    src."id",
    src."user_id",
    src."token_hash",
    src."csrf_hash",
    src."created_at",
    src."last_seen_at",
    src."idle_expires_at",
    src."absolute_expires_at",
    src."reauthenticated_at",
    COALESCE(src.revoked_at, CURRENT_TIMESTAMP),
    src."client_ip",
    src."user_agent"
FROM "auth_sessions" src;
DROP TABLE "auth_sessions";
ALTER TABLE "auth_sessions__account_upgrade" RENAME TO "auth_sessions";
CREATE INDEX ix_auth_sessions_user_active
  ON auth_sessions(user_id, revoked_at, absolute_expires_at);
CREATE INDEX ix_auth_sessions_token_hash ON auth_sessions(token_hash);

CREATE TABLE "management_api_keys__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
INSERT INTO "management_api_keys__account_upgrade" (
    "id",
    "user_id",
    "name",
    "key_hash",
    "key_prefix",
    "scopes",
    "expires_at",
    "last_used_at",
    "revoked_at",
    "revision",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    src."user_id",
    src."name",
    src."key_hash",
    src."key_prefix",
    src."scopes",
    src."expires_at",
    src."last_used_at",
    COALESCE(src.revoked_at, CURRENT_TIMESTAMP),
    src."revision",
    src."created_at",
    src."updated_at"
FROM "management_api_keys" src;
DROP TABLE "management_api_keys";
ALTER TABLE "management_api_keys__account_upgrade" RENAME TO "management_api_keys";

CREATE TABLE "security_audit_events__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  actor_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  target_user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  owner_user_id VARCHAR(36) REFERENCES users (id) ON DELETE SET NULL,
  event_type VARCHAR(64) NOT NULL,
  outcome VARCHAR(16) NOT NULL DEFAULT 'success',
  client_ip VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(500) NOT NULL DEFAULT '',
  metadata_json JSON NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "security_audit_events__account_upgrade" (
    "id",
    "actor_user_id",
    "target_user_id",
    "owner_user_id",
    "event_type",
    "outcome",
    "client_ip",
    "user_agent",
    "metadata_json",
    "created_at"
)
SELECT
    src."id",
    src."actor_user_id",
    src."target_user_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."event_type",
    src."outcome",
    src."client_ip",
    src."user_agent",
    src."metadata_json",
    src."created_at"
FROM "security_audit_events" src WHERE (src.workspace_id IS NULL OR (SELECT owner_user_id FROM
    _account_owners WHERE source_id=src."workspace_id") IS NOT NULL);
DROP TABLE "security_audit_events";
ALTER TABLE "security_audit_events__account_upgrade" RENAME TO "security_audit_events";
CREATE INDEX ix_security_audit_created ON security_audit_events(created_at DESC, id);
CREATE INDEX ix_security_audit_actor ON security_audit_events(actor_user_id, created_at DESC);
CREATE INDEX ix_security_audit_account ON security_audit_events(owner_user_id, created_at DESC);

CREATE TABLE "tool_navigation_items__account_upgrade" (
  owner_user_id VARCHAR(36) NOT NULL,
  tool_id VARCHAR(64) NOT NULL,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  favorite_updated_at TIMESTAMP,
  last_used_at TIMESTAMP,
  use_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_user_id, tool_id),
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE
);
INSERT INTO "tool_navigation_items__account_upgrade" (
    "owner_user_id",
    "tool_id",
    "is_favorite",
    "favorite_updated_at",
    "last_used_at",
    "use_count",
    "updated_at"
)
SELECT
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."tool_id",
    MAX(src."is_favorite"),
    src."favorite_updated_at",
    src."last_used_at",
    SUM(src."use_count"),
    src."updated_at"
FROM "tool_navigation_items" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL GROUP BY (SELECT owner_user_id FROM _account_owners
    WHERE source_id=src.workspace_id),src.tool_id;
DROP TABLE "tool_navigation_items";
ALTER TABLE "tool_navigation_items__account_upgrade" RENAME TO "tool_navigation_items";
CREATE INDEX ix_tool_navigation_account_last_used
  ON tool_navigation_items(owner_user_id, last_used_at DESC);

CREATE TABLE "model_template_sync_items__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 job_id VARCHAR(36) NOT NULL REFERENCES model_template_sync_jobs(id) ON DELETE CASCADE,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id),
 account_name VARCHAR(255) NOT NULL,
 catalog_revision INTEGER NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending',
 summary JSON NOT NULL, error_message TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "model_template_sync_items__account_upgrade" (
    "id",
    "job_id",
    "owner_user_id",
    "account_name",
    "catalog_revision",
    "status",
    "summary",
    "error_message",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    src."job_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    (SELECT display_name FROM users WHERE id = (SELECT owner_user_id FROM _account_owners WHERE
    source_id = src.workspace_id)),
    src."catalog_revision",
    src."status",
    src."summary",
    src."error_message",
    src."created_at",
    src."updated_at"
FROM "model_template_sync_items" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "model_template_sync_items";
ALTER TABLE "model_template_sync_items__account_upgrade" RENAME TO "model_template_sync_items";

CREATE TABLE "runtime_admissions__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 user_id VARCHAR(36) REFERENCES users(id), owner_user_id VARCHAR(36) NOT NULL REFERENCES users
    (id),
 platform_role VARCHAR(16) NOT NULL, realtime_voice BOOLEAN NOT NULL DEFAULT 0,
 weight INTEGER NOT NULL DEFAULT 1 CHECK(weight >= 1),
 task_kind VARCHAR(40), task_ids JSON NOT NULL DEFAULT '[]',
 released_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, waiting BOOLEAN NOT NULL DEFAULT 0, queue_task_id VARCHAR(36)
 REFERENCES visual_generation_tasks(id) ON DELETE CASCADE);
INSERT INTO "runtime_admissions__account_upgrade" (
    "id",
    "user_id",
    "owner_user_id",
    "platform_role",
    "realtime_voice",
    "weight",
    "task_kind",
    "task_ids",
    "released_at",
    "created_at",
    "waiting",
    "queue_task_id"
)
SELECT
    src."id",
    src."user_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    CASE WHEN src.platform_role IN ('admin','super_admin') THEN 'admin' ELSE 'user' END,
    src."realtime_voice",
    src."weight",
    src."task_kind",
    src."task_ids",
    src."released_at",
    src."created_at",
    src."waiting",
    src."queue_task_id"
FROM "runtime_admissions" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "runtime_admissions";
ALTER TABLE "runtime_admissions__account_upgrade" RENAME TO "runtime_admissions";
CREATE INDEX ix_runtime_admissions_active ON runtime_admissions(released_at, owner_user_id,
    user_id);
CREATE UNIQUE INDEX ix_runtime_admissions_queue_task ON runtime_admissions(queue_task_id);
CREATE INDEX ix_runtime_admissions_waiting_user
 ON runtime_admissions(waiting, released_at, user_id, created_at);

CREATE TABLE "project_operation_receipts__account_upgrade" (
    owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    resource_kind VARCHAR(40) NOT NULL,
    resource_id VARCHAR(64) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, resource_kind, resource_id, request_id)
);
INSERT INTO "project_operation_receipts__account_upgrade" (
    "owner_user_id",
    "resource_kind",
    "resource_id",
    "request_id",
    "fingerprint",
    "result",
    "created_at"
)
SELECT
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."resource_kind",
    src."resource_id",
    src."request_id",
    src."fingerprint",
    src."result",
    src."created_at"
FROM "project_operation_receipts" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "project_operation_receipts";
ALTER TABLE "project_operation_receipts__account_upgrade" RENAME TO "project_operation_receipts";
"""
