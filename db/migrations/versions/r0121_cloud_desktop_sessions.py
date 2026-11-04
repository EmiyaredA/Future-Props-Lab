MIGRATION_ID = "0121_cloud_desktop_sessions"

SQL = """
ALTER TABLE cloud_control_unlocks ADD COLUMN desktop_verified INTEGER NOT NULL DEFAULT 0;
CREATE TABLE cloud_desktop_preferences (
    owner_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    idle_minutes INTEGER NOT NULL CHECK (idle_minutes BETWEEN 5 AND 120),
    revision INTEGER NOT NULL
);
"""
