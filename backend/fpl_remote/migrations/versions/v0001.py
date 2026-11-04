"""Remote owns idle preferences, independent of the Identity session database."""

SQL = """
CREATE TABLE cloud_desktop_preferences (
    owner_user_id TEXT NOT NULL PRIMARY KEY,
    idle_minutes INTEGER NOT NULL CHECK (idle_minutes BETWEEN 5 AND 120),
    revision INTEGER NOT NULL
);
"""
