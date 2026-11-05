"""Store an authorized Galgame ASR dispatch until the Models outcome is settled."""

SQL = """
CREATE TABLE galgame_asr_dispatches (
    task_id VARCHAR(36) PRIMARY KEY
        REFERENCES galgame_asset_transcription_tasks(id) ON DELETE CASCADE,
    owner_user_id VARCHAR(36) NOT NULL,
    assertion TEXT NOT NULL,
    asset_revision INTEGER NOT NULL,
    transcript_revision INTEGER NOT NULL,
    byte_limit INTEGER NOT NULL,
    input JSON,
    checked_at DATETIME NOT NULL
);
CREATE INDEX ix_galgame_asr_dispatches_checked_at ON galgame_asr_dispatches(checked_at);
"""
