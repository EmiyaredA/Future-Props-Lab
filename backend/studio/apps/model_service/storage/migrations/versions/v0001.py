"""Initial Models-owned account selections; never adopts a monolith database."""

SQL = """CREATE TABLE model_account_defaults (
    owner_user_id VARCHAR(36) NOT NULL PRIMARY KEY,
    model_ids JSON NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
"""
