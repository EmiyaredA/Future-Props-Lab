"""Keep the scope of approved Visual generation results without a bearer token."""

SQL = """
CREATE TABLE identity_visual_generation_approvals (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admission JSON NOT NULL,
    actor JSON NOT NULL,
    content_sha256 TEXT,
    byte_size INTEGER
);
"""
