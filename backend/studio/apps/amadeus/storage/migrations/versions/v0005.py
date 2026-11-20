SQL = """
ALTER TABLE amadeus_runs ADD COLUMN input_ready_at DATETIME;
CREATE TABLE amadeus_run_instructions (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    run_id VARCHAR(36) NOT NULL REFERENCES amadeus_runs(id) ON DELETE CASCADE,
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    message_id VARCHAR(36) NOT NULL REFERENCES amadeus_messages(id) ON DELETE CASCADE,
    body_sha256 VARCHAR(64) NOT NULL,
    prompt TEXT NOT NULL,
    status VARCHAR(16) NOT NULL,
    dispatch_key VARCHAR(120),
    sequence INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE (run_id, request_id)
);
CREATE INDEX ix_amadeus_instructions_run_status ON amadeus_run_instructions(run_id, status);
"""
