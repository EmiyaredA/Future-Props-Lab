"""Account ownership for knowledge records."""

SQL = """
CREATE TABLE "thought_knowledge_bases__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 cover_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE RESTRICT,
 home_note_id VARCHAR(36),
 revision INTEGER NOT NULL DEFAULT 0,
 deleted_at DATETIME,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
INSERT INTO "thought_knowledge_bases__account_upgrade" (
    "id",
    "owner_user_id",
    "title",
    "description",
    "cover_asset_id",
    "home_note_id",
    "revision",
    "deleted_at",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."title",
    src."description",
    src."cover_asset_id",
    src."home_note_id",
    src."revision",
    src."deleted_at",
    src."created_at",
    src."updated_at"
FROM "thought_knowledge_bases" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "thought_knowledge_bases";
ALTER TABLE "thought_knowledge_bases__account_upgrade" RENAME TO "thought_knowledge_bases";
CREATE INDEX ix_thought_knowledge_bases_account ON thought_knowledge_bases(owner_user_id);

CREATE TABLE "thought_notes__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 knowledge_base_id VARCHAR(36) NOT NULL REFERENCES thought_knowledge_bases(id) ON DELETE CASCADE,
 parent_id VARCHAR(36) REFERENCES thought_notes(id) ON DELETE SET NULL,
 position INTEGER NOT NULL DEFAULT 0,
 is_home BOOLEAN NOT NULL DEFAULT 0,
 title VARCHAR(240) NOT NULL,
 document JSON NOT NULL,
 schema_version INTEGER NOT NULL DEFAULT 2,
 search_text TEXT NOT NULL DEFAULT '',
 tags JSON NOT NULL DEFAULT '[]',
 pinned BOOLEAN NOT NULL DEFAULT 0,
 favorite BOOLEAN NOT NULL DEFAULT 0,
 deleted_at DATETIME,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
, kind VARCHAR(20) NOT NULL DEFAULT 'note'
 CHECK(kind IN ('note', 'multitable')));
INSERT INTO "thought_notes__account_upgrade" (
    "id",
    "owner_user_id",
    "knowledge_base_id",
    "parent_id",
    "position",
    "is_home",
    "title",
    "document",
    "schema_version",
    "search_text",
    "tags",
    "pinned",
    "favorite",
    "deleted_at",
    "revision",
    "created_at",
    "updated_at",
    "kind"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."knowledge_base_id",
    src."parent_id",
    src."position",
    src."is_home",
    src."title",
    src."document",
    src."schema_version",
    src."search_text",
    src."tags",
    src."pinned",
    src."favorite",
    src."deleted_at",
    src."revision",
    src."created_at",
    src."updated_at",
    src."kind"
FROM "thought_notes" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "thought_notes";
ALTER TABLE "thought_notes__account_upgrade" RENAME TO "thought_notes";
CREATE INDEX ix_thought_notes_account_updated ON thought_notes(owner_user_id, updated_at);
CREATE INDEX ix_thought_notes_knowledge_base ON thought_notes(knowledge_base_id);
CREATE INDEX ix_thought_notes_parent ON thought_notes(parent_id);
CREATE UNIQUE INDEX ix_thought_notes_home ON thought_notes(knowledge_base_id) WHERE is_home = 1;

CREATE TABLE "thought_templates__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 name VARCHAR(120) NOT NULL, description TEXT NOT NULL, document JSON NOT NULL,
 tags JSON NOT NULL, schema_version INTEGER NOT NULL, revision INTEGER NOT NULL,
 created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
, kind VARCHAR(20) NOT NULL DEFAULT 'note', multitable JSON);
INSERT INTO "thought_templates__account_upgrade" (
    "id",
    "owner_user_id",
    "name",
    "description",
    "document",
    "tags",
    "schema_version",
    "revision",
    "created_at",
    "updated_at",
    "kind",
    "multitable"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."name",
    src."description",
    src."document",
    src."tags",
    src."schema_version",
    src."revision",
    src."created_at",
    src."updated_at",
    src."kind",
    src."multitable"
FROM "thought_templates" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "thought_templates";
ALTER TABLE "thought_templates__account_upgrade" RENAME TO "thought_templates";
CREATE INDEX ix_thought_templates_account ON thought_templates(owner_user_id);

CREATE TABLE "thought_saved_filters__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name VARCHAR(120) NOT NULL, criteria JSON NOT NULL, revision INTEGER NOT NULL
);
INSERT INTO "thought_saved_filters__account_upgrade" (
    "id",
    "owner_user_id",
    "user_id",
    "name",
    "criteria",
    "revision"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."user_id",
    src."name",
    src."criteria",
    src."revision"
FROM "thought_saved_filters" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "thought_saved_filters";
ALTER TABLE "thought_saved_filters__account_upgrade" RENAME TO "thought_saved_filters";
CREATE INDEX ix_thought_filters_owner ON thought_saved_filters(owner_user_id, user_id);

CREATE TABLE "thought_reading_states__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id VARCHAR(200) NOT NULL, title VARCHAR(240) NOT NULL,
 position JSON NOT NULL, visited_at DATETIME NOT NULL,
 UNIQUE(owner_user_id,user_id,resource_id)
);
INSERT INTO "thought_reading_states__account_upgrade" (
    "id",
    "owner_user_id",
    "user_id",
    "resource_id",
    "title",
    "position",
    "visited_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."user_id",
    src."resource_id",
    src."title",
    src."position",
    src."visited_at"
FROM "thought_reading_states" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL AND NOT EXISTS (SELECT 1 FROM
    "thought_reading_states" other JOIN _account_owners om ON om.source_id=other.workspace_id WHERE
    om.owner_user_id=(SELECT owner_user_id FROM _account_owners WHERE source_id=src.workspace_id)
    AND other.user_id=src.user_id AND other.resource_id=src.resource_id AND other.id<src.id);
DROP TABLE "thought_reading_states";
ALTER TABLE "thought_reading_states__account_upgrade" RENAME TO "thought_reading_states";
CREATE INDEX ix_thought_reading_owner ON thought_reading_states(owner_user_id,user_id,visited_at);

CREATE TABLE "thought_publications__account_upgrade" (
 id VARCHAR(36) PRIMARY KEY,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 knowledge_base_id VARCHAR(36) NOT NULL UNIQUE
 REFERENCES thought_knowledge_bases(id) ON DELETE CASCADE,
 publisher_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 title VARCHAR(240) NOT NULL, description TEXT NOT NULL,
 cover_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE RESTRICT,
 active BOOLEAN NOT NULL, revision INTEGER NOT NULL, updated_at DATETIME NOT NULL
, is_official BOOLEAN NOT NULL DEFAULT 0, read_only BOOLEAN NOT NULL DEFAULT 0,
    editable_platform_roles JSON NOT NULL DEFAULT '[]');
INSERT INTO "thought_publications__account_upgrade" (
    "id",
    "owner_user_id",
    "knowledge_base_id",
    "publisher_id",
    "title",
    "description",
    "cover_asset_id",
    "active",
    "revision",
    "updated_at",
    "is_official",
    "read_only",
    "editable_platform_roles"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."knowledge_base_id",
    src."publisher_id",
    src."title",
    src."description",
    src."cover_asset_id",
    src."active",
    src."revision",
    src."updated_at",
    src."is_official",
    src."read_only",
    src."editable_platform_roles"
FROM "thought_publications" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "thought_publications";
ALTER TABLE "thought_publications__account_upgrade" RENAME TO "thought_publications";
CREATE INDEX ix_thought_publications_account ON thought_publications(owner_user_id);

CREATE TABLE "thought_official_sources__account_upgrade" (
 note_id VARCHAR(36) PRIMARY KEY REFERENCES thought_notes(id) ON DELETE CASCADE,
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 library_key VARCHAR(80) NOT NULL, document_key VARCHAR(80) NOT NULL
);
INSERT INTO "thought_official_sources__account_upgrade" (
    "note_id",
    "owner_user_id",
    "library_key",
    "document_key"
)
SELECT
    src."note_id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."library_key",
    src."document_key"
FROM "thought_official_sources" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "thought_official_sources";
ALTER TABLE "thought_official_sources__account_upgrade" RENAME TO "thought_official_sources";
CREATE INDEX ix_thought_official_sources_owner_user_id ON thought_official_sources(owner_user_id);
CREATE INDEX ix_thought_official_sources_library_key ON thought_official_sources(library_key);

CREATE TABLE "thought_official_import_receipts__account_upgrade" (
 owner_user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id VARCHAR(36) NOT NULL, package_version VARCHAR(64) NOT NULL,
 result JSON NOT NULL, created_at DATETIME NOT NULL,
 PRIMARY KEY(owner_user_id,user_id,request_id)
);
INSERT INTO "thought_official_import_receipts__account_upgrade" (
    "owner_user_id",
    "user_id",
    "request_id",
    "package_version",
    "result",
    "created_at"
)
SELECT
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."user_id",
    src.request_id || ':' || src.workspace_id,
    src."package_version",
    src."result",
    src."created_at"
FROM "thought_official_import_receipts" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "thought_official_import_receipts";
ALTER TABLE "thought_official_import_receipts__account_upgrade" RENAME TO
    "thought_official_import_receipts";

CREATE TABLE "thought_sync_bindings__account_upgrade" (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	note_id VARCHAR(36) NOT NULL,
	connection_id VARCHAR(36) NOT NULL,
	document_id VARCHAR(200) NOT NULL,
	target_key VARCHAR(240) NOT NULL,
	url VARCHAR(2048) NOT NULL,
	title VARCHAR(240) NOT NULL,
	revision INTEGER NOT NULL,
	last_fingerprint VARCHAR(64) NOT NULL,
	last_note_revision INTEGER,
	last_synced_at DATETIME,
	PRIMARY KEY (id),
	UNIQUE (note_id),
	UNIQUE (target_key),
	FOREIGN KEY(owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
	FOREIGN KEY(note_id) REFERENCES thought_notes (id) ON DELETE CASCADE,
	FOREIGN KEY(connection_id) REFERENCES integration_external_connections (id) ON DELETE RESTRICT
);
INSERT INTO "thought_sync_bindings__account_upgrade" (
    "id",
    "owner_user_id",
    "note_id",
    "connection_id",
    "document_id",
    "target_key",
    "url",
    "title",
    "revision",
    "last_fingerprint",
    "last_note_revision",
    "last_synced_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."note_id",
    src."connection_id",
    src."document_id",
    src."target_key",
    src."url",
    src."title",
    src."revision",
    src."last_fingerprint",
    src."last_note_revision",
    src."last_synced_at"
FROM "thought_sync_bindings" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "thought_sync_bindings";
ALTER TABLE "thought_sync_bindings__account_upgrade" RENAME TO "thought_sync_bindings";
CREATE INDEX ix_thought_sync_bindings_owner_user_id ON thought_sync_bindings (owner_user_id);

CREATE TABLE "thought_sync_tasks__account_upgrade" (
	id VARCHAR(36) NOT NULL,
	owner_user_id VARCHAR(36) NOT NULL,
	note_id VARCHAR(36) NOT NULL,
	binding_id VARCHAR(36) NOT NULL,
	binding_revision INTEGER NOT NULL,
	connection_id VARCHAR(36) NOT NULL,
	connection_revision INTEGER NOT NULL,
	target_key VARCHAR(240) NOT NULL,
	actor JSON NOT NULL,
	operation_id VARCHAR(36),
	note_revision INTEGER NOT NULL,
	status VARCHAR(24) NOT NULL,
	content JSON NOT NULL,
	remote JSON NOT NULL,
	checkpoint JSON NOT NULL,
	message TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (owner_user_id, operation_id),
	FOREIGN KEY(owner_user_id) REFERENCES users (id) ON DELETE CASCADE
);
INSERT INTO "thought_sync_tasks__account_upgrade" (
    "id",
    "owner_user_id",
    "note_id",
    "binding_id",
    "binding_revision",
    "connection_id",
    "connection_revision",
    "target_key",
    "actor",
    "operation_id",
    "note_revision",
    "status",
    "content",
    "remote",
    "checkpoint",
    "message",
    "created_at",
    "updated_at"
)
SELECT
    src."id",
    (SELECT owner_user_id FROM _account_owners WHERE source_id = src."workspace_id"),
    src."note_id",
    src."binding_id",
    src."binding_revision",
    src."connection_id",
    src."connection_revision",
    src."target_key",
    src."actor",
    src."operation_id" || ':' || src.workspace_id,
    src."note_revision",
    src."status",
    src."content",
    src."remote",
    src."checkpoint",
    src."message",
    src."created_at",
    src."updated_at"
FROM "thought_sync_tasks" src WHERE (SELECT owner_user_id FROM _account_owners WHERE
    source_id=src."workspace_id") IS NOT NULL;
DROP TABLE "thought_sync_tasks";
ALTER TABLE "thought_sync_tasks__account_upgrade" RENAME TO "thought_sync_tasks";
CREATE INDEX ix_thought_sync_tasks_note_id ON thought_sync_tasks (note_id);
CREATE INDEX ix_thought_sync_tasks_owner_user_id ON thought_sync_tasks (owner_user_id);
CREATE UNIQUE INDEX uq_thought_sync_active_target ON thought_sync_tasks (target_key) WHERE status
    IN ('queued','running','needs_review');
"""
