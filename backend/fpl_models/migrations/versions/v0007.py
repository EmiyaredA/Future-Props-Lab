"""Models owns demo policy, governance receipts and original template sync authority."""

SQL = """CREATE TABLE model_demo_settings (
    id VARCHAR(32) NOT NULL PRIMARY KEY,
    payload JSON NOT NULL,
    revision INTEGER NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE TABLE model_governance_audit (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    actor_user_id VARCHAR(36) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    detail JSON NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE TABLE model_template_sync_authority (
    job_id VARCHAR(36) NOT NULL PRIMARY KEY,
    source_path VARCHAR(4096) NOT NULL,
    assertion VARCHAR(8192) NOT NULL
);
"""
