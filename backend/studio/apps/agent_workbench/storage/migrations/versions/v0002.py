"""Own Workbench project chats and turns without the legacy Identity schema."""

SQL = """
CREATE TABLE workbench_chats (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX ix_workbench_chats_owner ON workbench_chats(owner_user_id, created_at);

CREATE TABLE workbench_turns (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
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
