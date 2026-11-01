"""Account ownership for animation records."""

SQL = """
CREATE TABLE "director_desk_projects__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 document JSON NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
INSERT INTO "director_desk_projects__account_upgrade" (
    "id",
    "owner_user_id",
    "title",
    "document",
    "revision",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."title",
    src."document",
    src."revision",
    src."created_at",
    src."updated_at"
FROM "director_desk_projects" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "director_desk_projects";
ALTER TABLE "director_desk_projects__account_upgrade" RENAME TO "director_desk_projects";
CREATE INDEX ix_director_desk_projects_account_updated
 ON director_desk_projects(owner_user_id, updated_at);

CREATE TABLE "director_desk_user_motions__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 motion_key VARCHAR(200) NOT NULL,
 name VARCHAR(100) NOT NULL,
 motion JSON NOT NULL,
 resource JSON NOT NULL,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 UNIQUE (owner_user_id, motion_key)
);
INSERT INTO "director_desk_user_motions__account_upgrade" (
    "id",
    "owner_user_id",
    "motion_key",
    "name",
    "motion",
    "resource",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."motion_key",
    src."name",
    src."motion",
    src."resource",
    src."created_at",
    src."updated_at"
FROM "director_desk_user_motions" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "director_desk_user_motions";
ALTER TABLE "director_desk_user_motions__account_upgrade" RENAME TO "director_desk_user_motions";
CREATE INDEX ix_director_desk_user_motions_account_name
 ON director_desk_user_motions(owner_user_id, name);

CREATE TABLE "motion_compositor_projects__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
INSERT INTO "motion_compositor_projects__account_upgrade" (
    "id",
    "owner_user_id",
    "title",
    "revision",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."title",
    src."revision",
    src."created_at",
    src."updated_at"
FROM "motion_compositor_projects" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "motion_compositor_projects";
ALTER TABLE "motion_compositor_projects__account_upgrade" RENAME TO "motion_compositor_projects";
CREATE INDEX ix_motion_projects_account_updated
 ON motion_compositor_projects(owner_user_id, updated_at);

CREATE TABLE "motion_compositor_operation_batches__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 project_id VARCHAR(36) NOT NULL REFERENCES motion_compositor_projects(id) ON DELETE CASCADE,
 request_id VARCHAR(64) NOT NULL,
 base_revision INTEGER NOT NULL,
 result_revision INTEGER NOT NULL,
 operations JSON NOT NULL,
 result_document JSON NOT NULL,
 created_at DATETIME NOT NULL,
 UNIQUE(project_id, request_id)
);
INSERT INTO "motion_compositor_operation_batches__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "request_id",
    "base_revision",
    "result_revision",
    "operations",
    "result_document",
    "created_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."project_id",
    src."request_id",
    src."base_revision",
    src."result_revision",
    src."operations",
    src."result_document",
    src."created_at"
FROM "motion_compositor_operation_batches" src WHERE (SELECT owner_user_id FROM _account_owners
    WHERE source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "motion_compositor_operation_batches";
ALTER TABLE "motion_compositor_operation_batches__account_upgrade" RENAME TO
    "motion_compositor_operation_batches";

CREATE TABLE "motion_compositor_tasks__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 project_id VARCHAR(36) NOT NULL REFERENCES motion_compositor_projects(id) ON DELETE CASCADE,
 request_id VARCHAR(64) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'queued',
 progress INTEGER NOT NULL DEFAULT 0,
 request_payload JSON NOT NULL,
 snapshot_document JSON NOT NULL,
 outputs JSON NOT NULL DEFAULT '{}',
 error TEXT,
 cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 UNIQUE(project_id, request_id)
);
INSERT INTO "motion_compositor_tasks__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "request_id",
    "status",
    "progress",
    "request_payload",
    "snapshot_document",
    "outputs",
    "error",
    "cancel_requested",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."project_id",
    src."request_id",
    src."status",
    src."progress",
    src."request_payload",
    src."snapshot_document",
    src."outputs",
    src."error",
    src."cancel_requested",
    src."created_at",
    src."updated_at"
FROM "motion_compositor_tasks" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "motion_compositor_tasks";
ALTER TABLE "motion_compositor_tasks__account_upgrade" RENAME TO "motion_compositor_tasks";
CREATE INDEX ix_motion_tasks_status_created ON motion_compositor_tasks(status, created_at);

CREATE TABLE "live2d_projects__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 document JSON NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
);
INSERT INTO "live2d_projects__account_upgrade" (
    "id",
    "owner_user_id",
    "title",
    "revision",
    "document",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."title",
    src."revision",
    src."document",
    src."created_at",
    src."updated_at"
FROM "live2d_projects" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "live2d_projects";
ALTER TABLE "live2d_projects__account_upgrade" RENAME TO "live2d_projects";
CREATE INDEX ix_live2d_account_updated ON live2d_projects(owner_user_id, updated_at);

CREATE TABLE "live2d_assets__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 project_id VARCHAR(36) NOT NULL REFERENCES live2d_projects(id) ON DELETE CASCADE,
 name VARCHAR(255) NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 created_at DATETIME NOT NULL
);
INSERT INTO "live2d_assets__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "name",
    "width",
    "height",
    "created_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."project_id",
    src."name",
    src."width",
    src."height",
    src."created_at"
FROM "live2d_assets" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "live2d_assets";
ALTER TABLE "live2d_assets__account_upgrade" RENAME TO "live2d_assets";
CREATE INDEX ix_live2d_assets_project_id ON live2d_assets(project_id);

CREATE TABLE "live2d_exports__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 project_id VARCHAR(36) NOT NULL REFERENCES live2d_projects(id) ON DELETE CASCADE,
 request_id VARCHAR(64) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'queued',
 progress INTEGER NOT NULL DEFAULT 0, payload JSON NOT NULL, snapshot JSON NOT NULL,
 error TEXT, cancel_requested BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME NOT NULL,
 UNIQUE(project_id, request_id)
);
INSERT INTO "live2d_exports__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "request_id",
    "status",
    "progress",
    "payload",
    "snapshot",
    "error",
    "cancel_requested",
    "created_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."project_id",
    src."request_id",
    src."status",
    src."progress",
    src."payload",
    src."snapshot",
    src."error",
    src."cancel_requested",
    src."created_at"
FROM "live2d_exports" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "live2d_exports";
ALTER TABLE "live2d_exports__account_upgrade" RENAME TO "live2d_exports";
CREATE INDEX ix_live2d_exports_project_id ON live2d_exports(project_id);

CREATE TABLE "live2d_cubism_attachments__account_upgrade" (
 project_id VARCHAR(36) PRIMARY KEY REFERENCES live2d_projects(id) ON DELETE CASCADE,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 sha256 VARCHAR(64) NOT NULL,
 metadata JSON NOT NULL,
 state_bindings JSON NOT NULL,
 created_at DATETIME NOT NULL
);
INSERT INTO "live2d_cubism_attachments__account_upgrade" (
    "project_id",
    "owner_user_id",
    "sha256",
    "metadata",
    "state_bindings",
    "created_at"
)
SELECT
    src."project_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."sha256",
    src."metadata",
    src."state_bindings",
    src."created_at"
FROM "live2d_cubism_attachments" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "live2d_cubism_attachments";
ALTER TABLE "live2d_cubism_attachments__account_upgrade" RENAME TO "live2d_cubism_attachments";
CREATE INDEX ix_live2d_cubism_account ON live2d_cubism_attachments(owner_user_id);

CREATE TABLE "desktop_pet_projects__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 source_type VARCHAR(32) NOT NULL DEFAULT 'live2d',
 source_project_id VARCHAR(36),
 source_revision INTEGER,
 source_title VARCHAR(120) NOT NULL,
 title VARCHAR(120) NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 character JSON,
 whale_model JSON,
 whale_assets JSON,
 config JSON NOT NULL,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
INSERT INTO "desktop_pet_projects__account_upgrade" (
    "id",
    "owner_user_id",
    "source_type",
    "source_project_id",
    "source_revision",
    "source_title",
    "title",
    "revision",
    "character",
    "whale_model",
    "whale_assets",
    "config",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."source_type",
    src."source_project_id",
    src."source_revision",
    src."source_title",
    src."title",
    src."revision",
    src."character",
    src."whale_model",
    src."whale_assets",
    src."config",
    src."created_at",
    src."updated_at"
FROM "desktop_pet_projects" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "desktop_pet_projects";
ALTER TABLE "desktop_pet_projects__account_upgrade" RENAME TO "desktop_pet_projects";
CREATE INDEX ix_desktop_pet_account_updated ON desktop_pet_projects(owner_user_id, updated_at);

CREATE TABLE "desktop_pet_chats__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 project_id VARCHAR(36) NOT NULL REFERENCES desktop_pet_projects(id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
 proactive_lines_enabled BOOLEAN NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 0,
 active_request_id VARCHAR(64),
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL, presentation_mode VARCHAR(16)
 NOT NULL DEFAULT 'dialogue' CHECK (presentation_mode IN ('bubble', 'dialogue')),
 UNIQUE (owner_user_id, project_id, user_id)
);
INSERT INTO "desktop_pet_chats__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "user_id",
    "model_id",
    "proactive_lines_enabled",
    "revision",
    "active_request_id",
    "created_at",
    "updated_at",
    "presentation_mode"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."project_id",
    src."user_id",
    src."model_id",
    src."proactive_lines_enabled",
    src."revision",
    src."active_request_id",
    src."created_at",
    src."updated_at",
    src."presentation_mode"
FROM "desktop_pet_chats" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "desktop_pet_chats";
ALTER TABLE "desktop_pet_chats__account_upgrade" RENAME TO "desktop_pet_chats";
CREATE INDEX ix_desktop_pet_chats_user ON desktop_pet_chats(user_id, owner_user_id);
"""
