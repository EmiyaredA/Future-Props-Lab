"""Initialize only the Director-owned project and motion records."""

SQL = """
CREATE TABLE director_desk_projects (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL,
    document JSON NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_director_desk_projects_account_updated
    ON director_desk_projects (owner_user_id, updated_at);

CREATE TABLE director_desk_user_motions (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    motion_key VARCHAR(200) NOT NULL,
    name VARCHAR(100) NOT NULL,
    motion JSON NOT NULL,
    resource JSON NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE (owner_user_id, motion_key)
);
CREATE INDEX ix_director_desk_user_motions_account_name
    ON director_desk_user_motions (owner_user_id, name);
"""
