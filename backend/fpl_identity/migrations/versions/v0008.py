"""Identity owns cloud factors and verification attached to Studio sessions."""

SQL = """
CREATE TABLE cloud_control_factors (
    owner_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret TEXT,
    pending_secret TEXT,
    pending_until INTEGER NOT NULL,
    last_counter INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    attempt_window INTEGER NOT NULL
);
CREATE TABLE cloud_control_unlocks (
    session_id TEXT PRIMARY KEY REFERENCES auth_sessions(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    ticket_hash TEXT,
    ticket_until INTEGER NOT NULL,
    desktop_verified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_cloud_control_unlocks_owner ON cloud_control_unlocks(owner_user_id);
"""
