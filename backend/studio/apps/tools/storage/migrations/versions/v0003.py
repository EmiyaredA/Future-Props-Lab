"""Keep accepted video byte descriptors in the owning Tools database."""

SQL = """
CREATE TABLE tools_download_artifacts (
    job_id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    description JSON NOT NULL,
    library_asset JSON,
    created_at DATETIME NOT NULL,
    FOREIGN KEY(job_id) REFERENCES tools_native_jobs (id) ON DELETE CASCADE
);
CREATE INDEX ix_tools_download_artifacts_owner_user_id
    ON tools_download_artifacts (owner_user_id);
"""
