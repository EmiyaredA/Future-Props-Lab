from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration(
        "0001_spreadsheet",
        """
CREATE TABLE spreadsheet_workbooks (
    id VARCHAR(36) PRIMARY KEY, owner_user_id VARCHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL, document JSON NOT NULL, revision INTEGER NOT NULL,
    calculation VARCHAR(24) NOT NULL, created_at VARCHAR(40) NOT NULL,
    updated_at VARCHAR(40) NOT NULL, source_key VARCHAR(64), source_name VARCHAR(255)
);
CREATE INDEX ix_spreadsheet_workbooks_owner_user_id ON spreadsheet_workbooks(owner_user_id);
CREATE TABLE spreadsheet_receipts (
    owner_user_id VARCHAR(36) NOT NULL, resource_id VARCHAR(64) NOT NULL,
    request_id VARCHAR(64) NOT NULL, fingerprint VARCHAR(64) NOT NULL, result JSON NOT NULL,
    PRIMARY KEY (owner_user_id, resource_id, request_id)
);
CREATE TABLE spreadsheet_imports (
    id VARCHAR(36) PRIMARY KEY, owner_user_id VARCHAR(36) NOT NULL,
    sha256 VARCHAR(64) NOT NULL, filename VARCHAR(255) NOT NULL, source_key VARCHAR(64) NOT NULL,
    document JSON NOT NULL, warnings JSON NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX ix_spreadsheet_imports_owner_user_id ON spreadsheet_imports(owner_user_id);
""",
    ),
)
