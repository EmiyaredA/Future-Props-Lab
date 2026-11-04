"""Store the independent library's complete document examples."""

SQL = """
CREATE TABLE presentation_examples (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    document JSON NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_presentation_examples_account_updated
    ON presentation_examples (owner_user_id, updated_at);
"""
