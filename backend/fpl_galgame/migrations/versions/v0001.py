"""Initial owned Galgame tables. External resource identifiers are opaque."""

SQL = """
CREATE TABLE galgame_certification_receipts (
    owner_user_id VARCHAR(36) NOT NULL,
    id VARCHAR(36) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    authority VARCHAR(8192),
    audit_event_id VARCHAR(36),
    audit_proof VARCHAR(8192),
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, id)
);

CREATE INDEX ix_galgame_certification_receipts_pending
    ON galgame_certification_receipts (audit_event_id, created_at);

CREATE TABLE galgame_workshop_projects (
    is_official BOOLEAN NOT NULL,
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL,
    status VARCHAR(16) NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id)
);

CREATE INDEX ix_galgame_workshop_projects_owner_user_id ON galgame_workshop_projects
    (owner_user_id);

CREATE INDEX ix_galgame_workshop_projects_updated_at ON galgame_workshop_projects (updated_at,
    created_at);

CREATE TABLE galgame_annotation_import_tasks (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    source_project_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    expected_source_revision INTEGER NOT NULL,
    expected_story_revision INTEGER NOT NULL,
    request_payload JSON NOT NULL,
    status VARCHAR(24) NOT NULL,
    progress INTEGER NOT NULL,
    result_detail JSON NOT NULL,
    error TEXT,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    started_at DATETIME,
    finished_at DATETIME,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES galgame_workshop_projects (id) ON DELETE CASCADE,
    UNIQUE (owner_user_id, project_id, request_id)
);

CREATE INDEX ix_galgame_annotation_import_tasks_owner_user_id ON galgame_annotation_import_tasks
    (owner_user_id);

CREATE INDEX ix_galgame_annotation_import_tasks_project_status ON galgame_annotation_import_tasks
    (project_id, status, created_at);

CREATE TABLE galgame_asset_metadata (
    asset_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    category VARCHAR(32) NOT NULL,
    virtual_path VARCHAR(512) NOT NULL,
    packaging_policy VARCHAR(16) NOT NULL,
    checksum_sha256 VARCHAR(64),
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    transcript TEXT,
    transcript_language VARCHAR(16),
    transcript_status VARCHAR(16) NOT NULL,
    transcript_source VARCHAR(16),
    transcript_revision INTEGER NOT NULL,
    transcript_segments JSON NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (asset_id),
    FOREIGN KEY(project_id) REFERENCES galgame_workshop_projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_galgame_asset_metadata_project_path ON galgame_asset_metadata (project_id,
    virtual_path);

CREATE TABLE galgame_asset_settings (
    project_id VARCHAR(36) NOT NULL,
    asr_model_id VARCHAR(36),
    default_language VARCHAR(16) NOT NULL,
    concurrency INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (project_id),
    FOREIGN KEY(project_id) REFERENCES galgame_workshop_projects (id) ON DELETE CASCADE
);

CREATE TABLE galgame_asset_transcription_tasks (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    asset_id VARCHAR(36) NOT NULL,
    provider_id VARCHAR(36),
    provider_name VARCHAR(120) NOT NULL,
    model_id VARCHAR(36),
    model_slug VARCHAR(160) NOT NULL,
    language VARCHAR(16) NOT NULL,
    force BOOLEAN NOT NULL,
    status VARCHAR(16) NOT NULL,
    result_text TEXT,
    result_segments JSON NOT NULL,
    error TEXT,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    started_at DATETIME,
    finished_at DATETIME,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES galgame_workshop_projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_galgame_asset_transcription_tasks_owner_user_id ON
    galgame_asset_transcription_tasks (owner_user_id);

CREATE INDEX ix_galgame_asset_transcription_tasks_project_status ON
    galgame_asset_transcription_tasks (project_id, status, created_at);

CREATE TABLE galgame_project_asset_references (
    id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    asset_id VARCHAR(36) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES galgame_workshop_projects (id) ON DELETE CASCADE,
    UNIQUE (project_id, asset_id)
);

CREATE INDEX ix_galgame_project_asset_references_asset ON galgame_project_asset_references
    (asset_id);

CREATE TABLE galgame_story_documents (
    project_id VARCHAR(36) NOT NULL,
    document JSON NOT NULL,
    revision INTEGER NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (project_id),
    FOREIGN KEY(project_id) REFERENCES galgame_workshop_projects (id) ON DELETE CASCADE
);

CREATE TABLE galgame_story_snapshots (
    id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    story_revision INTEGER NOT NULL,
    reason VARCHAR(64) NOT NULL,
    document JSON NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES galgame_workshop_projects (id) ON DELETE CASCADE
);

CREATE INDEX ix_galgame_story_snapshots_project_created ON galgame_story_snapshots (project_id,
    created_at);

CREATE TABLE galgame_video_editor_handoffs (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    snapshot_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    story_revision INTEGER NOT NULL,
    request_payload JSON NOT NULL,
    status VARCHAR(16) NOT NULL,
    progress INTEGER NOT NULL,
    result_detail JSON NOT NULL,
    output_project_id VARCHAR(36),
    cancel_requested BOOLEAN NOT NULL,
    error TEXT,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    started_at DATETIME,
    finished_at DATETIME,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES galgame_workshop_projects (id) ON DELETE CASCADE,
    FOREIGN KEY(snapshot_id) REFERENCES galgame_story_snapshots (id) ON DELETE RESTRICT,
    UNIQUE (owner_user_id, project_id, request_id)
);

CREATE INDEX ix_galgame_video_editor_handoffs_owner_user_id ON galgame_video_editor_handoffs
    (owner_user_id);

CREATE INDEX ix_galgame_video_editor_handoffs_project_status ON galgame_video_editor_handoffs
    (project_id, status, created_at);

CREATE TABLE galgame_video_export_tasks (
    id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    snapshot_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    story_revision INTEGER NOT NULL,
    request_payload JSON NOT NULL,
    status VARCHAR(16) NOT NULL,
    progress INTEGER NOT NULL,
    result_detail JSON NOT NULL,
    output_asset_id VARCHAR(36),
    cancel_requested BOOLEAN NOT NULL,
    error TEXT,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    started_at DATETIME,
    finished_at DATETIME,
    PRIMARY KEY (id),
    FOREIGN KEY(project_id) REFERENCES galgame_workshop_projects (id) ON DELETE CASCADE,
    FOREIGN KEY(snapshot_id) REFERENCES galgame_story_snapshots (id) ON DELETE RESTRICT,
    UNIQUE (owner_user_id, project_id, request_id)
);

CREATE INDEX ix_galgame_video_export_tasks_owner_user_id ON galgame_video_export_tasks
    (owner_user_id);

CREATE INDEX ix_galgame_video_export_tasks_project_status ON galgame_video_export_tasks
    (project_id, status, created_at);
"""
