"""Account ownership for media records."""

SQL = """
CREATE TABLE "audio_annotation_projects__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,
  asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
  title VARCHAR(120) NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 3600000),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "audio_annotation_projects__account_upgrade" (
    "id",
    "owner_user_id",
    "asset_id",
    "title",
    "duration_ms",
    "revision",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."asset_id",
    src."title",
    src."duration_ms",
    src."revision",
    src."created_at",
    src."updated_at"
FROM "audio_annotation_projects" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "audio_annotation_projects";
ALTER TABLE "audio_annotation_projects__account_upgrade" RENAME TO "audio_annotation_projects";
CREATE INDEX ix_audio_annotation_projects_account_updated
  ON audio_annotation_projects(owner_user_id, updated_at DESC, created_at DESC);
CREATE INDEX ix_audio_annotation_projects_asset
  ON audio_annotation_projects(asset_id);

CREATE TABLE "video_editor_projects__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, source_application VARCHAR(32), source_project_id VARCHAR(36), source_revision INTEGER,
    source_compiler_version VARCHAR(64));
INSERT INTO "video_editor_projects__account_upgrade" (
    "id",
    "owner_user_id",
    "title",
    "status",
    "revision",
    "created_at",
    "updated_at",
    "source_application",
    "source_project_id",
    "source_revision",
    "source_compiler_version"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."title",
    src."status",
    src."revision",
    src."created_at",
    src."updated_at",
    src."source_application",
    src."source_project_id",
    src."source_revision",
    src."source_compiler_version"
FROM "video_editor_projects" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "video_editor_projects";
ALTER TABLE "video_editor_projects__account_upgrade" RENAME TO "video_editor_projects";
CREATE INDEX ix_video_editor_projects_account_updated ON video_editor_projects(owner_user_id,
    updated_at);

CREATE TABLE "video_editor_operation_batches__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
  request_id VARCHAR(64) NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
  operations JSON NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, request_id)
);
INSERT INTO "video_editor_operation_batches__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "request_id",
    "base_revision",
    "result_revision",
    "operations",
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
    src."created_at"
FROM "video_editor_operation_batches" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "video_editor_operation_batches";
ALTER TABLE "video_editor_operation_batches__account_upgrade" RENAME TO
    "video_editor_operation_batches";
CREATE INDEX ix_video_editor_operation_project_created ON
    video_editor_operation_batches(project_id, created_at);

CREATE TABLE "presentation_projects__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL, document JSON NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
);
INSERT INTO "presentation_projects__account_upgrade" (
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
FROM "presentation_projects" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "presentation_projects";
ALTER TABLE "presentation_projects__account_upgrade" RENAME TO "presentation_projects";
CREATE INDEX ix_presentation_projects_account_updated
 ON presentation_projects(owner_user_id, updated_at);

CREATE TABLE "creative_items__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  origin_owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('tool_api', 'mcp', 'skill', 'bundle')),
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'withdrawn')),
  title VARCHAR(120) NOT NULL DEFAULT '',
  summary VARCHAR(500) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tags JSON NOT NULL DEFAULT '[]',
  cover_preset VARCHAR(32) NOT NULL DEFAULT 'sunrise',
  draft_manifest JSON NOT NULL DEFAULT '{}',
  draft_components JSON NOT NULL DEFAULT '[]',
  draft_cover_path VARCHAR(1024) NOT NULL DEFAULT '',
  draft_skill_path VARCHAR(1024) NOT NULL DEFAULT '',
  current_release_id VARCHAR(36),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "creative_items__account_upgrade" (
    "id",
    "origin_owner_user_id",
    "author_user_id",
    "kind",
    "status",
    "title",
    "summary",
    "description",
    "tags",
    "cover_preset",
    "draft_manifest",
    "draft_components",
    "draft_cover_path",
    "draft_skill_path",
    "current_release_id",
    "revision",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."origin_workspace_id"),
    src."author_user_id",
    src."kind",
    src."status",
    src."title",
    src."summary",
    src."description",
    src."tags",
    src."cover_preset",
    src."draft_manifest",
    src."draft_components",
    src."draft_cover_path",
    src."draft_skill_path",
    src."current_release_id",
    src."revision",
    src."created_at",
    src."updated_at"
FROM "creative_items" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."origin_workspace_id") IS NOT NULL;
DROP TABLE "creative_items";
ALTER TABLE "creative_items__account_upgrade" RENAME TO "creative_items";
CREATE INDEX ix_creative_items_public
  ON creative_items(status, kind, updated_at);
CREATE INDEX ix_creative_items_owner
  ON creative_items(origin_owner_user_id, author_user_id, updated_at);

CREATE TABLE "creative_installations__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  release_id VARCHAR(36) NOT NULL REFERENCES creative_releases(id) ON DELETE RESTRICT,
  installed_by_user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resources JSON NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_user_id, release_id)
);
INSERT INTO "creative_installations__account_upgrade" (
    "id",
    "owner_user_id",
    "release_id",
    "installed_by_user_id",
    "resources",
    "created_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."release_id",
    src."installed_by_user_id",
    src."resources",
    src."created_at"
FROM "creative_installations" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL AND NOT EXISTS (SELECT 1 FROM
    "creative_installations" other JOIN _account_owners om ON om.source_id=other.workspace_id WHERE
    om.owner_user_id=(SELECT owner_user_id FROM _account_owners WHERE source_id=src.workspace_id)
    AND other.release_id=src.release_id AND other.id<src.id);
DROP TABLE "creative_installations";
ALTER TABLE "creative_installations__account_upgrade" RENAME TO "creative_installations";
CREATE INDEX ix_creative_installations_workspace
  ON creative_installations(owner_user_id, created_at);

CREATE TABLE "video_editor_tasks__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
  request_id VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('media', 'render', 'segment_export', 'asset_bake',
    'clip_merge')),
  status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed',
    'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  request_payload JSON NOT NULL DEFAULT '{}',
  snapshot_document JSON NOT NULL DEFAULT '{}',
  result_detail JSON NOT NULL DEFAULT '{}',
  output_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  error TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  UNIQUE(project_id, request_id)
);
INSERT INTO "video_editor_tasks__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "request_id",
    "kind",
    "status",
    "progress",
    "request_payload",
    "snapshot_document",
    "result_detail",
    "output_asset_id",
    "error",
    "cancel_requested",
    "revision",
    "created_at",
    "updated_at",
    "started_at",
    "finished_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."project_id",
    src."request_id",
    src."kind",
    src."status",
    src."progress",
    src."request_payload",
    src."snapshot_document",
    src."result_detail",
    src."output_asset_id",
    src."error",
    src."cancel_requested",
    src."revision",
    src."created_at",
    src."updated_at",
    src."started_at",
    src."finished_at"
FROM "video_editor_tasks" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "video_editor_tasks";
ALTER TABLE "video_editor_tasks__account_upgrade" RENAME TO "video_editor_tasks";
CREATE INDEX ix_video_editor_tasks_status_created ON video_editor_tasks(status, created_at);
CREATE INDEX ix_video_editor_tasks_project_created ON video_editor_tasks(project_id, created_at);

CREATE TABLE "presentation_templates__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 description VARCHAR(1000) NOT NULL DEFAULT '',
 definition JSON NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
 created_at TIMESTAMP NOT NULL,
 updated_at TIMESTAMP NOT NULL
);
INSERT INTO "presentation_templates__account_upgrade" (
    "id",
    "owner_user_id",
    "title",
    "description",
    "definition",
    "revision",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."title",
    src."description",
    src."definition",
    src."revision",
    src."created_at",
    src."updated_at"
FROM "presentation_templates" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "presentation_templates";
ALTER TABLE "presentation_templates__account_upgrade" RENAME TO "presentation_templates";
CREATE INDEX ix_presentation_templates_account_updated
 ON presentation_templates(owner_user_id, updated_at);

CREATE TABLE "presentation_examples__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 description VARCHAR(1000) NOT NULL DEFAULT '',
 document JSON NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
 created_at TIMESTAMP NOT NULL,
 updated_at TIMESTAMP NOT NULL
);
INSERT INTO "presentation_examples__account_upgrade" (
    "id",
    "owner_user_id",
    "title",
    "description",
    "document",
    "revision",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."title",
    src."description",
    src."document",
    src."revision",
    src."created_at",
    src."updated_at"
FROM "presentation_examples" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "presentation_examples";
ALTER TABLE "presentation_examples__account_upgrade" RENAME TO "presentation_examples";
CREATE INDEX ix_presentation_examples_account_updated
 ON presentation_examples(owner_user_id, updated_at);
"""
