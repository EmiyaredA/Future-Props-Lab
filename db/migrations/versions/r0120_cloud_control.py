MIGRATION_ID = "0120_cloud_control"

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
    ticket_until INTEGER NOT NULL
);
CREATE INDEX ix_cloud_control_unlocks_owner ON cloud_control_unlocks(owner_user_id);

CREATE TABLE workbench_chats (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX ix_workbench_chats_owner ON workbench_chats(owner_user_id, created_at);

CREATE TABLE workbench_turns (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL REFERENCES workbench_chats(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    answer TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    approvals JSON NOT NULL,
    revision INTEGER NOT NULL,
    UNIQUE (chat_id, client_id),
    UNIQUE (chat_id, position)
);
CREATE UNIQUE INDEX ux_workbench_active_turn ON workbench_turns(chat_id)
    WHERE status IN ('running', 'waiting_approval', 'cancelling');
"""
