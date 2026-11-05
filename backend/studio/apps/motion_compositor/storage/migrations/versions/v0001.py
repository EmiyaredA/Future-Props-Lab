"""Independent project, document and edit receipt tables."""

SQL = """
CREATE TABLE motion_compositor_projects (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_motion_projects_account_updated
    ON motion_compositor_projects (owner_user_id, updated_at);

CREATE TABLE motion_compositor_documents (
    project_id VARCHAR(36) PRIMARY KEY
      REFERENCES motion_compositor_projects(id) ON DELETE CASCADE,
    document JSON NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
    updated_at DATETIME NOT NULL
);

CREATE TABLE motion_compositor_operation_batches (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL REFERENCES motion_compositor_projects(id) ON DELETE CASCADE,
    request_id VARCHAR(64) NOT NULL,
    base_revision INTEGER NOT NULL,
    result_revision INTEGER NOT NULL,
    operations JSON NOT NULL,
    result_document JSON NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE(project_id, request_id)
);
"""
