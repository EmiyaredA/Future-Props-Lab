"""Account-private interview input snapshots and Codex preparation history."""

MIGRATION_ID = "0106_interview_preparation"
SQL = """CREATE TABLE interview_rooms (
        id VARCHAR(36) PRIMARY KEY NOT NULL,
        workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id VARCHAR(36) NOT NULL,
        title VARCHAR(120) NOT NULL,
        revision INTEGER NOT NULL,
        input_version INTEGER NOT NULL,
        active_task_id VARCHAR(36),
        active_bundle_id VARCHAR(36),
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
    );
    CREATE INDEX ix_interview_rooms_workspace_id ON interview_rooms(workspace_id);
    CREATE INDEX ix_interview_rooms_user_id ON interview_rooms(user_id);
    CREATE TABLE interview_materials (
        id VARCHAR(36) PRIMARY KEY NOT NULL,
        room_id VARCHAR(36) NOT NULL REFERENCES interview_rooms(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        sha256 VARCHAR(64) NOT NULL,
        size INTEGER NOT NULL,
        created_at DATETIME NOT NULL
    );
    CREATE INDEX ix_interview_materials_room_id ON interview_materials(room_id);
    CREATE TABLE interview_preparations (
        id VARCHAR(36) PRIMARY KEY NOT NULL,
        workspace_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        room_id VARCHAR(36) NOT NULL REFERENCES interview_rooms(id) ON DELETE CASCADE,
        request_id VARCHAR(100) NOT NULL,
        fingerprint VARCHAR(64) NOT NULL,
        input_hash VARCHAR(64) NOT NULL,
        input_version INTEGER NOT NULL,
        snapshot JSON NOT NULL,
        status VARCHAR(24) NOT NULL,
        revision INTEGER NOT NULL,
        events JSON NOT NULL,
        result JSON,
        message VARCHAR(1000) NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE(room_id, request_id)
    );
    CREATE INDEX ix_interview_preparations_workspace_id ON interview_preparations(workspace_id);
    CREATE INDEX ix_interview_preparations_room_id ON interview_preparations(room_id);
    """
