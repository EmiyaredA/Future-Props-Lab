"""Role model policy belongs to Models, independently of Identity settings."""

SQL = """CREATE TABLE model_role_templates (
    role VARCHAR(16) NOT NULL PRIMARY KEY CHECK(role IN ('admin', 'user')),
    payload JSON NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
"""
