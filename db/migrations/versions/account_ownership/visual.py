"""Account ownership for visual records."""

SQL = """
CREATE TABLE "visual_workshop_projects__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(120) NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('image', 'video', 'canvas')),
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, owner_user_id VARCHAR(36) NOT NULL, is_official BOOLEAN NOT NULL DEFAULT 0);
INSERT INTO "visual_workshop_projects__account_upgrade" (
    "id",
    "title",
    "kind",
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
    src."kind",
    src."status",
    src."revision",
    src."created_at",
    src."updated_at",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."is_official"
FROM "visual_workshop_projects" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_workshop_projects";
ALTER TABLE "visual_workshop_projects__account_upgrade" RENAME TO "visual_workshop_projects";
CREATE INDEX ix_visual_workshop_projects_updated_at
  ON visual_workshop_projects(updated_at DESC, created_at DESC);
CREATE INDEX ix_visual_projects_account_updated
  ON visual_workshop_projects(owner_user_id, updated_at DESC);

CREATE TABLE "visual_asset_folders__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36),
  parent_id VARCHAR(36),
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, owner_user_id VARCHAR(36) NOT NULL,
  FOREIGN KEY (project_id) REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES visual_asset_folders(id) ON DELETE CASCADE
);
INSERT INTO "visual_asset_folders__account_upgrade" (
    "id",
    "project_id",
    "parent_id",
    "name",
    "revision",
    "created_at",
    "updated_at",
    "owner_user_id"
)
SELECT
    src."id",
    src."project_id",
    src."parent_id",
    src."name",
    src."revision",
    src."created_at",
    src."updated_at",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id")
FROM "visual_asset_folders" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_asset_folders";
ALTER TABLE "visual_asset_folders__account_upgrade" RENAME TO "visual_asset_folders";
CREATE UNIQUE INDEX ux_visual_asset_folders_scope_parent_name
  ON visual_asset_folders (
    owner_user_id, ifnull(project_id, ''), ifnull(parent_id, ''), lower(name)
  );
CREATE INDEX ix_visual_asset_folders_project_parent
  ON visual_asset_folders(project_id, parent_id, created_at);
CREATE INDEX ix_visual_folders_account ON visual_asset_folders(owner_user_id, project_id,
    parent_id);

CREATE TABLE "visual_assets__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36),
  folder_id VARCHAR(36),
  original_filename VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 255),
  storage_key VARCHAR(64) NOT NULL UNIQUE,
  media_kind VARCHAR(16) NOT NULL
    CHECK (media_kind IN ('image', 'video', 'audio', 'document')),
  mime_type VARCHAR(120) NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, galgame_project_id VARCHAR(36)
    REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE, storage_version INTEGER NOT NULL
    DEFAULT 1
    CHECK (storage_version IN (1, 2)), owner_user_id VARCHAR(36) NOT NULL, video_editor_project_id
    VARCHAR(36) REFERENCES video_editor_projects(id) ON DELETE CASCADE,
    motion_compositor_project_id VARCHAR(36)
 REFERENCES motion_compositor_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES visual_asset_folders(id) ON DELETE CASCADE
);
INSERT INTO "visual_assets__account_upgrade" (
    "id",
    "project_id",
    "folder_id",
    "original_filename",
    "display_name",
    "storage_key",
    "media_kind",
    "mime_type",
    "byte_size",
    "revision",
    "created_at",
    "updated_at",
    "galgame_project_id",
    "storage_version",
    "owner_user_id",
    "video_editor_project_id",
    "motion_compositor_project_id"
)
SELECT
    src."id",
    src."project_id",
    src."folder_id",
    src."original_filename",
    src."display_name",
    src."storage_key",
    src."media_kind",
    src."mime_type",
    src."byte_size",
    src."revision",
    src."created_at",
    src."updated_at",
    src."galgame_project_id",
    src."storage_version",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."video_editor_project_id",
    src."motion_compositor_project_id"
FROM "visual_assets" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_assets";
ALTER TABLE "visual_assets__account_upgrade" RENAME TO "visual_assets";
CREATE INDEX ix_visual_assets_project_folder_updated
  ON visual_assets(project_id, folder_id, updated_at DESC, created_at DESC);
CREATE INDEX ix_visual_assets_galgame_project_updated
  ON visual_assets(galgame_project_id, updated_at DESC, created_at DESC);
CREATE INDEX ix_visual_assets_storage_version
  ON visual_assets(storage_version, created_at);
CREATE INDEX ix_visual_assets_account_updated ON visual_assets(owner_user_id, updated_at DESC);
CREATE INDEX ix_visual_assets_video_editor_project ON visual_assets(video_editor_project_id,
    updated_at);
CREATE INDEX ix_visual_assets_motion_project
 ON visual_assets(motion_compositor_project_id, updated_at);

CREATE TABLE "visual_project_asset_references__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  asset_id VARCHAR(36) NOT NULL,
  folder_id VARCHAR(36),
  display_name VARCHAR(255) NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 255),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, owner_user_id VARCHAR(36) NOT NULL,
  FOREIGN KEY (project_id) REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES visual_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (folder_id) REFERENCES visual_asset_folders(id) ON DELETE CASCADE,
  UNIQUE (project_id, asset_id)
);
INSERT INTO "visual_project_asset_references__account_upgrade" (
    "id",
    "project_id",
    "asset_id",
    "folder_id",
    "display_name",
    "revision",
    "created_at",
    "updated_at",
    "owner_user_id"
)
SELECT
    src."id",
    src."project_id",
    src."asset_id",
    src."folder_id",
    src."display_name",
    src."revision",
    src."created_at",
    src."updated_at",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id")
FROM "visual_project_asset_references" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_project_asset_references";
ALTER TABLE "visual_project_asset_references__account_upgrade" RENAME TO
    "visual_project_asset_references";
CREATE INDEX ix_visual_project_asset_references_folder
  ON visual_project_asset_references(project_id, folder_id, updated_at DESC);

CREATE TABLE "visual_assistant_conversations__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL
    REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL DEFAULT 'AI 助手对话',
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
, image_model_id VARCHAR(36)
    REFERENCES model_entries(id) ON DELETE SET NULL, video_model_id VARCHAR(36)
    REFERENCES model_entries(id) ON DELETE SET NULL, owner_user_id VARCHAR(36) NOT NULL);
INSERT INTO "visual_assistant_conversations__account_upgrade" (
    "id",
    "project_id",
    "title",
    "model_id",
    "revision",
    "created_at",
    "updated_at",
    "image_model_id",
    "video_model_id",
    "owner_user_id"
)
SELECT
    src."id",
    src."project_id",
    src."title",
    src."model_id",
    src."revision",
    src."created_at",
    src."updated_at",
    src."image_model_id",
    src."video_model_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id")
FROM "visual_assistant_conversations" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_assistant_conversations";
ALTER TABLE "visual_assistant_conversations__account_upgrade" RENAME TO
    "visual_assistant_conversations";
CREATE INDEX ix_visual_assistant_conversations_project_updated
  ON visual_assistant_conversations(project_id, updated_at DESC, created_at DESC);
CREATE INDEX ix_visual_assistant_conversations_model
  ON visual_assistant_conversations(model_id);
CREATE INDEX ix_visual_assistant_conversations_image_model
  ON visual_assistant_conversations(image_model_id);
CREATE INDEX ix_visual_assistant_conversations_video_model
  ON visual_assistant_conversations(video_model_id);

CREATE TABLE "visual_acceptance_templates__account_upgrade" (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	title VARCHAR(120) NOT NULL,
	document JSON NOT NULL,
	revision INTEGER NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id)
);
INSERT INTO "visual_acceptance_templates__account_upgrade" (
    "id",
    "owner_user_id",
    "title",
    "document",
    "revision",
    "created_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."title",
    src."document",
    src."revision",
    src."created_at"
FROM "visual_acceptance_templates" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_acceptance_templates";
ALTER TABLE "visual_acceptance_templates__account_upgrade" RENAME TO "visual_acceptance_templates";
CREATE INDEX ix_visual_acceptance_templates_owner_user_id ON visual_acceptance_templates
    (owner_user_id);

CREATE TABLE "visual_acceptance_standards__account_upgrade" (
	project_id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	draft JSON NOT NULL,
	published_version INTEGER NOT NULL,
	required BOOLEAN NOT NULL,
	revision INTEGER NOT NULL,
	PRIMARY KEY (project_id),
	FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);
INSERT INTO "visual_acceptance_standards__account_upgrade" (
    "project_id",
    "owner_user_id",
    "draft",
    "published_version",
    "required",
    "revision"
)
SELECT
    src."project_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."draft",
    src."published_version",
    src."required",
    src."revision"
FROM "visual_acceptance_standards" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_acceptance_standards";
ALTER TABLE "visual_acceptance_standards__account_upgrade" RENAME TO "visual_acceptance_standards";
CREATE INDEX ix_visual_acceptance_standards_owner_user_id ON visual_acceptance_standards
    (owner_user_id);

CREATE TABLE "visual_acceptance_standard_versions__account_upgrade" (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	project_id VARCHAR(36) NOT NULL,
	version INTEGER NOT NULL,
	document JSON NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (project_id, version),
	FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE
);
INSERT INTO "visual_acceptance_standard_versions__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "version",
    "document",
    "created_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."project_id",
    src."version",
    src."document",
    src."created_at"
FROM "visual_acceptance_standard_versions" src WHERE (SELECT owner_user_id FROM _account_owners
    WHERE source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_acceptance_standard_versions";
ALTER TABLE "visual_acceptance_standard_versions__account_upgrade" RENAME TO
    "visual_acceptance_standard_versions";
CREATE INDEX ix_visual_acceptance_standard_versions_owner_user_id ON
    visual_acceptance_standard_versions (owner_user_id);

CREATE TABLE "visual_acceptance_runs__account_upgrade" (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	project_id VARCHAR(36) NOT NULL,
	node_id VARCHAR(64) NOT NULL,
	output_id VARCHAR(36) NOT NULL,
	standard_id VARCHAR(36) NOT NULL,
	previous_run_id VARCHAR(36),
	request_id VARCHAR(100) NOT NULL,
	fingerprint VARCHAR(64) NOT NULL,
	model_id VARCHAR(36),
	status VARCHAR(24) NOT NULL,
	decision VARCHAR(24) NOT NULL,
	snapshot JSON NOT NULL,
	results JSON NOT NULL,
	evidence JSON NOT NULL,
	decisions JSON NOT NULL,
	error_message TEXT,
	revision INTEGER NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL, scheme_id VARCHAR(64) NOT NULL DEFAULT 'legacy', execution_result
    JSON NOT NULL DEFAULT '{}',
	PRIMARY KEY (id),
	UNIQUE (project_id, request_id, output_id),
	FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE,
	FOREIGN KEY(output_id) REFERENCES visual_node_outputs (id) ON DELETE RESTRICT,
	FOREIGN KEY(standard_id) REFERENCES visual_acceptance_standard_versions (id) ON DELETE RESTRICT
);
INSERT INTO "visual_acceptance_runs__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "node_id",
    "output_id",
    "standard_id",
    "previous_run_id",
    "request_id",
    "fingerprint",
    "model_id",
    "status",
    "decision",
    "snapshot",
    "results",
    "evidence",
    "decisions",
    "error_message",
    "revision",
    "created_at",
    "updated_at",
    "scheme_id",
    "execution_result"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."project_id",
    src."node_id",
    src."output_id",
    src."standard_id",
    src."previous_run_id",
    src."request_id",
    src."fingerprint",
    src."model_id",
    src."status",
    src."decision",
    src."snapshot",
    src."results",
    src."evidence",
    src."decisions",
    src."error_message",
    src."revision",
    src."created_at",
    src."updated_at",
    src."scheme_id",
    src."execution_result"
FROM "visual_acceptance_runs" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_acceptance_runs";
ALTER TABLE "visual_acceptance_runs__account_upgrade" RENAME TO "visual_acceptance_runs";
CREATE INDEX ix_visual_acceptance_runs_project_id ON visual_acceptance_runs (project_id);
CREATE INDEX ix_visual_acceptance_runs_owner_user_id ON visual_acceptance_runs (owner_user_id);

CREATE TABLE "visual_acceptance_repair_drafts__account_upgrade" (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	project_id VARCHAR(36) NOT NULL,
	run_id VARCHAR(36) NOT NULL,
	text TEXT NOT NULL,
	revision INTEGER NOT NULL,
	prompt_version_id VARCHAR(64),
	PRIMARY KEY (id),
	FOREIGN KEY(project_id) REFERENCES visual_workshop_projects (id) ON DELETE CASCADE,
	FOREIGN KEY(run_id) REFERENCES visual_acceptance_runs (id) ON DELETE CASCADE
);
INSERT INTO "visual_acceptance_repair_drafts__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "run_id",
    "text",
    "revision",
    "prompt_version_id"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."project_id",
    src."run_id",
    src."text",
    src."revision",
    src."prompt_version_id"
FROM "visual_acceptance_repair_drafts" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_acceptance_repair_drafts";
ALTER TABLE "visual_acceptance_repair_drafts__account_upgrade" RENAME TO
    "visual_acceptance_repair_drafts";
CREATE INDEX ix_visual_acceptance_repair_drafts_owner_user_id ON visual_acceptance_repair_drafts
    (owner_user_id);

CREATE TABLE "visual_node_acceptance_bindings__account_upgrade" (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
    node_id VARCHAR(64) NOT NULL,
    scheme_id VARCHAR(64),
    revision INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id, node_id)
);
INSERT INTO "visual_node_acceptance_bindings__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "node_id",
    "scheme_id",
    "revision"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."project_id",
    src."node_id",
    src."scheme_id",
    src."revision"
FROM "visual_node_acceptance_bindings" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_node_acceptance_bindings";
ALTER TABLE "visual_node_acceptance_bindings__account_upgrade" RENAME TO
    "visual_node_acceptance_bindings";
CREATE INDEX ix_visual_node_acceptance_bindings_owner_user_id
ON visual_node_acceptance_bindings(owner_user_id);

CREATE TABLE "visual_generation_tasks__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  provider_id VARCHAR(36) REFERENCES model_providers(id) ON DELETE SET NULL,
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  provider_kind VARCHAR(24) NOT NULL CHECK (
    provider_kind IN ('senseaudio_image', 'volcengine_image', 'senseaudio_video',
'volcengine_video', 'zealman_video', 'autodl_video', 'senseaudio_music', 'senseaudio_sfx')
  ),
  generation_kind VARCHAR(16) NOT NULL CHECK (generation_kind IN ('image', 'video', 'audio')),
  provider_name VARCHAR(120) NOT NULL,
  model_slug VARCHAR(160) NOT NULL,
  request_payload JSON NOT NULL DEFAULT '{}',
  provider_task_id VARCHAR(255),
  status VARCHAR(16) NOT NULL CHECK (
    status IN ('queued', 'submitting', 'pending', 'processing', 'completed', 'failed', 'cancelled')
  ),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_message TEXT,
  result_url TEXT,
  result_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  owner_user_id VARCHAR(36) NOT NULL
, canvas_node_id VARCHAR(64), execution_info JSON, submitted_at TIMESTAMP);
INSERT INTO "visual_generation_tasks__account_upgrade" (
    "id",
    "project_id",
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
    "result_asset_id",
    "revision",
    "created_at",
    "updated_at",
    "completed_at",
    "owner_user_id",
    "canvas_node_id",
    "execution_info",
    "submitted_at"
)
SELECT
    src."id",
    src."project_id",
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
    src."result_asset_id",
    src."revision",
    src."created_at",
    src."updated_at",
    src."completed_at",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."canvas_node_id",
    src."execution_info",
    src."submitted_at"
FROM "visual_generation_tasks" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_generation_tasks";
ALTER TABLE "visual_generation_tasks__account_upgrade" RENAME TO "visual_generation_tasks";
CREATE INDEX ix_visual_generation_tasks_project_created
  ON visual_generation_tasks(project_id, created_at DESC);
CREATE INDEX ix_visual_generation_tasks_status_updated
  ON visual_generation_tasks(status, updated_at);
CREATE INDEX ix_visual_generation_tasks_provider
  ON visual_generation_tasks(provider_id, status);
CREATE INDEX ix_visual_generation_tasks_project_canvas_node_created
  ON visual_generation_tasks(project_id, canvas_node_id, created_at DESC);

CREATE TABLE "visual_generation_batches__account_upgrade" (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  grid_size INTEGER NOT NULL CHECK (grid_size IN (4, 9)),
  grid_output VARCHAR(16) NOT NULL CHECK (grid_output IN ('nodes', 'composite')),
  child_task_ids JSON NOT NULL DEFAULT '[]',
  status VARCHAR(16) NOT NULL CHECK (
    status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')
  ),
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  result_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  error_message TEXT,
  generation_node_id VARCHAR(64),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  batch_kind VARCHAR(16) NOT NULL DEFAULT 'generation'
    CHECK (batch_kind IN ('generation', 'composition')),
  source_items JSON NOT NULL DEFAULT '[]',
  cancelled_count INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "visual_generation_batches__account_upgrade" (
    "id",
    "owner_user_id",
    "project_id",
    "grid_size",
    "grid_output",
    "child_task_ids",
    "status",
    "completed_count",
    "failed_count",
    "result_asset_id",
    "error_message",
    "generation_node_id",
    "revision",
    "created_at",
    "updated_at",
    "completed_at",
    "batch_kind",
    "source_items",
    "cancelled_count"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."project_id",
    src."grid_size",
    src."grid_output",
    src."child_task_ids",
    src."status",
    src."completed_count",
    src."failed_count",
    src."result_asset_id",
    src."error_message",
    src."generation_node_id",
    src."revision",
    src."created_at",
    src."updated_at",
    src."completed_at",
    src."batch_kind",
    src."source_items",
    src."cancelled_count"
FROM "visual_generation_batches" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "visual_generation_batches";
ALTER TABLE "visual_generation_batches__account_upgrade" RENAME TO "visual_generation_batches";
CREATE INDEX ix_visual_generation_batches_project_created
  ON visual_generation_batches(project_id, created_at DESC);
CREATE INDEX ix_visual_generation_batches_status_updated
  ON visual_generation_batches(status, updated_at);
"""
