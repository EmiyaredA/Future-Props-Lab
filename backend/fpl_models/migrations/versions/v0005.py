"""Models execution policy has its own CAS record, independently of Identity settings."""

SQL = """CREATE TABLE model_quota_policy (
    id VARCHAR(16) NOT NULL PRIMARY KEY CHECK(id = 'runtime'),
    payload JSON NOT NULL,
    revision INTEGER NOT NULL,
    updated_at DATETIME NOT NULL
);
"""
