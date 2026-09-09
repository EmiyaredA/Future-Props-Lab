MIGRATION_ID = "r0051_platform_governance"

SQL = """
ALTER TABLE users ADD COLUMN platform_role VARCHAR(16) NOT NULL DEFAULT 'member'
 CHECK (platform_role IN ('super_admin','admin','member'));
UPDATE users SET platform_role = 'super_admin' WHERE is_platform_admin = 1;
CREATE INDEX ix_users_platform_role ON users(platform_role);
CREATE TABLE platform_settings (
 id VARCHAR(100) PRIMARY KEY, payload JSON NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE registration_invite_codes (
 id VARCHAR(36) PRIMARY KEY, name VARCHAR(120) NOT NULL,
 code_hash VARCHAR(64) NOT NULL UNIQUE, code_hint VARCHAR(40) NOT NULL,
 secret_ciphertext TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT 1,
 max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 10000),
 used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count >= 0 AND used_count <= max_uses),
 validity_days INTEGER NOT NULL CHECK(validity_days BETWEEN 1 AND 365),
 expires_at TIMESTAMP NOT NULL, deleted_at TIMESTAMP,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE registration_redemptions (
 id VARCHAR(36) PRIMARY KEY,
 invite_id VARCHAR(36) NOT NULL REFERENCES registration_invite_codes(id),
 user_id VARCHAR(36) NOT NULL REFERENCES users(id),
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id)
);
CREATE INDEX ix_registration_redemptions_invite ON registration_redemptions(invite_id);
"""
