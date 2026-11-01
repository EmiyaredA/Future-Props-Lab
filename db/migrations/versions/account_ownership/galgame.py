"""Account ownership for galgame records."""

SQL = """
CREATE TABLE "galgame_workshop_projects__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(120) NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, owner_user_id VARCHAR(36) NOT NULL, is_official BOOLEAN NOT NULL DEFAULT 0);
INSERT INTO "galgame_workshop_projects__account_upgrade" (
    "id",
    "title",
    "status",
    "revision",
    "created_at",
    "updated_at",
    "owner_user_id",
    "is_official"
)
SELECT
    src."id",
    src."title",
    src."status",
    src."revision",
    src."created_at",
    src."updated_at",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."is_official"
FROM "galgame_workshop_projects" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "galgame_workshop_projects";
ALTER TABLE "galgame_workshop_projects__account_upgrade" RENAME TO "galgame_workshop_projects";
CREATE INDEX ix_galgame_workshop_projects_updated_at
  ON galgame_workshop_projects(updated_at DESC, created_at DESC);
CREATE INDEX ix_galgame_projects_account_updated
  ON galgame_workshop_projects(owner_user_id, updated_at DESC);

CREATE TABLE "galgame_asset_transcription_tasks__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  asset_id VARCHAR(36) NOT NULL,
  provider_id VARCHAR(36),
  provider_name VARCHAR(120) NOT NULL DEFAULT '',
  model_id VARCHAR(36),
  model_slug VARCHAR(160) NOT NULL DEFAULT '',
  language VARCHAR(16) NOT NULL DEFAULT 'auto',
  force BOOLEAN NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  result_text TEXT,
  error TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP, owner_user_id VARCHAR(36) NOT NULL, result_segments JSON NOT NULL DEFAULT
    '[]',
  FOREIGN KEY (project_id) REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES visual_assets(id) ON DELETE CASCADE,
  CHECK (language IN ('auto', 'zh', 'ja')),
  CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);
INSERT INTO "galgame_asset_transcription_tasks__account_upgrade" (
    "id",
    "project_id",
    "asset_id",
    "provider_id",
    "provider_name",
    "model_id",
    "model_slug",
    "language",
    "force",
    "status",
    "result_text",
    "error",
    "revision",
    "created_at",
    "started_at",
    "finished_at",
    "owner_user_id",
    "result_segments"
)
SELECT
    src."id",
    src."project_id",
    src."asset_id",
    src."provider_id",
    src."provider_name",
    src."model_id",
    src."model_slug",
    src."language",
    src."force",
    src."status",
    src."result_text",
    src."error",
    src."revision",
    src."created_at",
    src."started_at",
    src."finished_at",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."result_segments"
FROM "galgame_asset_transcription_tasks" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "galgame_asset_transcription_tasks";
ALTER TABLE "galgame_asset_transcription_tasks__account_upgrade" RENAME TO
    "galgame_asset_transcription_tasks";
CREATE INDEX ix_galgame_asset_transcription_tasks_project_status
  ON galgame_asset_transcription_tasks(project_id, status, created_at);

CREATE TABLE "galgame_annotation_import_tasks__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL
    REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
  source_project_id VARCHAR(36) NOT NULL
    REFERENCES audio_annotation_projects(id) ON DELETE RESTRICT,
  request_id VARCHAR(64) NOT NULL,
  expected_source_revision INTEGER NOT NULL CHECK (expected_source_revision >= 0),
  expected_story_revision INTEGER NOT NULL CHECK (expected_story_revision >= 0),
  request_payload JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'conflict', 'rolled_back')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result_detail JSON NOT NULL DEFAULT '{}',
  error TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  UNIQUE (owner_user_id, project_id, request_id)
);
INSERT INTO "galgame_annotation_import_tasks__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "source_project_id",
    "request_id",
    "expected_source_revision",
    "expected_story_revision",
    "request_payload",
    "status",
    "progress",
    "result_detail",
    "error",
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
    src."source_project_id",
    src."request_id",
    src."expected_source_revision",
    src."expected_story_revision",
    src."request_payload",
    src."status",
    src."progress",
    src."result_detail",
    src."error",
    src."revision",
    src."created_at",
    src."updated_at",
    src."started_at",
    src."finished_at"
FROM "galgame_annotation_import_tasks" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "galgame_annotation_import_tasks";
ALTER TABLE "galgame_annotation_import_tasks__account_upgrade" RENAME TO
    "galgame_annotation_import_tasks";
CREATE INDEX ix_galgame_annotation_import_tasks_project_status
  ON galgame_annotation_import_tasks(project_id, status, created_at);

CREATE TABLE "galgame_video_export_tasks__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL
    REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
  snapshot_id VARCHAR(36) NOT NULL
    REFERENCES galgame_story_snapshots(id) ON DELETE RESTRICT,
  request_id VARCHAR(64) NOT NULL,
  story_revision INTEGER NOT NULL CHECK (story_revision >= 0),
  request_payload JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result_detail JSON NOT NULL DEFAULT '{}',
  output_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  cancel_requested BOOLEAN NOT NULL DEFAULT 0,
  error TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  UNIQUE (owner_user_id, project_id, request_id)
);
INSERT INTO "galgame_video_export_tasks__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "snapshot_id",
    "request_id",
    "story_revision",
    "request_payload",
    "status",
    "progress",
    "result_detail",
    "output_asset_id",
    "cancel_requested",
    "error",
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
    src."snapshot_id",
    src."request_id",
    src."story_revision",
    src."request_payload",
    src."status",
    src."progress",
    src."result_detail",
    src."output_asset_id",
    src."cancel_requested",
    src."error",
    src."revision",
    src."created_at",
    src."updated_at",
    src."started_at",
    src."finished_at"
FROM "galgame_video_export_tasks" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "galgame_video_export_tasks";
ALTER TABLE "galgame_video_export_tasks__account_upgrade" RENAME TO "galgame_video_export_tasks";
CREATE INDEX ix_galgame_video_export_tasks_project_status
  ON galgame_video_export_tasks(project_id, status, created_at);

CREATE TABLE "galgame_video_editor_handoffs__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
  snapshot_id VARCHAR(36) NOT NULL REFERENCES galgame_story_snapshots(id) ON DELETE RESTRICT,
  request_id VARCHAR(64) NOT NULL,
  story_revision INTEGER NOT NULL CHECK (story_revision >= 0),
  request_payload JSON NOT NULL DEFAULT '{}',
  status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed',
    'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result_detail JSON NOT NULL DEFAULT '{}',
  output_project_id VARCHAR(36) REFERENCES video_editor_projects(id) ON DELETE SET NULL,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  UNIQUE(owner_user_id, project_id, request_id)
);
INSERT INTO "galgame_video_editor_handoffs__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "snapshot_id",
    "request_id",
    "story_revision",
    "request_payload",
    "status",
    "progress",
    "result_detail",
    "output_project_id",
    "cancel_requested",
    "error",
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
    src."snapshot_id",
    src."request_id",
    src."story_revision",
    src."request_payload",
    src."status",
    src."progress",
    src."result_detail",
    src."output_project_id",
    src."cancel_requested",
    src."error",
    src."revision",
    src."created_at",
    src."updated_at",
    src."started_at",
    src."finished_at"
FROM "galgame_video_editor_handoffs" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "galgame_video_editor_handoffs";
ALTER TABLE "galgame_video_editor_handoffs__account_upgrade" RENAME TO
    "galgame_video_editor_handoffs";
CREATE INDEX ix_galgame_video_editor_handoffs_project_status
  ON galgame_video_editor_handoffs(project_id, status, created_at);
"""
