"""Initial Presentation document, template and operation store."""

SQL = """
CREATE TABLE presentation_projects (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL,
    document JSON NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_presentation_projects_account_updated
    ON presentation_projects (owner_user_id, updated_at);

CREATE TABLE presentation_templates (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    definition JSON NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_presentation_templates_account_updated
    ON presentation_templates (owner_user_id, updated_at);

CREATE TABLE presentation_reference_mutations (
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    change_sha256 VARCHAR(64) NOT NULL,
    change JSON NOT NULL,
    authority TEXT NOT NULL,
    state VARCHAR(16) NOT NULL,
    asset_intent_id VARCHAR(128),
    resource_revision INTEGER,
    deleted BOOLEAN NOT NULL,
    delivered_result JSON,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, request_id)
);
CREATE INDEX ix_presentation_reference_mutations_state
    ON presentation_reference_mutations (state);

CREATE TABLE project_operation_receipts (
    owner_user_id VARCHAR(36) NOT NULL,
    resource_kind VARCHAR(40) NOT NULL,
    resource_id VARCHAR(64) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, resource_kind, resource_id, request_id)
);
"""
