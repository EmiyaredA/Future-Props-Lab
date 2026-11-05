"""Session purpose is owned solely by Identity; legacy sessions remain studio sessions."""

SQL = """
ALTER TABLE auth_sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'studio'
    CHECK (purpose IN ('studio', 'management'));
"""
