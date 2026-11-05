"""Keep the exact source assertion for a still-active Annotation import."""

SQL = """
CREATE TABLE galgame_annotation_authorizations (
    task_id VARCHAR(36) PRIMARY KEY
        REFERENCES galgame_annotation_import_tasks(id) ON DELETE CASCADE,
    owner_user_id VARCHAR(36) NOT NULL,
    assertion TEXT NOT NULL
);
"""
