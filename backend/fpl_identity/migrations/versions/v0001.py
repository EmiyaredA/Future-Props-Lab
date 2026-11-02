"""Initial Identity schema. Frozen before any persistent deployment."""

SQL = """CREATE TABLE identity_account_events (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	event_type VARCHAR(64) NOT NULL, 
	payload JSON NOT NULL, 
	revision INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	delivered_at DATETIME, 
	PRIMARY KEY (id)
);

CREATE INDEX ix_identity_account_events_delivered_at ON identity_account_events (delivered_at);

CREATE INDEX ix_identity_account_events_user_id ON identity_account_events (user_id);

CREATE TABLE registration_invite_codes (
	id VARCHAR(36) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	code_hash VARCHAR(64) NOT NULL, 
	code_hint VARCHAR(40) NOT NULL, 
	secret_ciphertext TEXT NOT NULL, 
	enabled BOOLEAN NOT NULL, 
	max_uses INTEGER NOT NULL, 
	used_count INTEGER NOT NULL, 
	validity_days INTEGER NOT NULL, 
	expires_at DATETIME NOT NULL, 
	deleted_at DATETIME, 
	revision INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (code_hash)
);

CREATE TABLE users (
	id VARCHAR(36) NOT NULL, 
	username VARCHAR(64) NOT NULL, 
	username_normalized VARCHAR(64) NOT NULL, 
	display_name VARCHAR(120) NOT NULL, 
	email VARCHAR(254), 
	email_normalized VARCHAR(254), 
	avatar_relative_path VARCHAR(512) NOT NULL, 
	avatar_content_type VARCHAR(64) NOT NULL, 
	avatar_content_sha256 VARCHAR(64) NOT NULL, 
	password_hash TEXT NOT NULL, 
	status VARCHAR(16) NOT NULL, 
	is_platform_admin BOOLEAN NOT NULL, 
	platform_role VARCHAR(16) NOT NULL, 
	must_change_password BOOLEAN NOT NULL, 
	revision INTEGER NOT NULL, 
	last_login_at DATETIME, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (email_normalized)
);

CREATE INDEX ix_users_is_platform_admin ON users (is_platform_admin);

CREATE INDEX ix_users_platform_role ON users (platform_role);

CREATE INDEX ix_users_status ON users (status);

CREATE UNIQUE INDEX ix_users_username_normalized ON users (username_normalized);

CREATE TABLE auth_sessions (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	csrf_hash VARCHAR(64) NOT NULL, 
	created_at DATETIME NOT NULL, 
	last_seen_at DATETIME NOT NULL, 
	idle_expires_at DATETIME NOT NULL, 
	absolute_expires_at DATETIME NOT NULL, 
	reauthenticated_at DATETIME NOT NULL, 
	revoked_at DATETIME, 
	client_ip VARCHAR(64) NOT NULL, 
	user_agent VARCHAR(500) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_auth_sessions_absolute_expires_at ON auth_sessions (absolute_expires_at);

CREATE INDEX ix_auth_sessions_idle_expires_at ON auth_sessions (idle_expires_at);

CREATE INDEX ix_auth_sessions_revoked_at ON auth_sessions (revoked_at);

CREATE UNIQUE INDEX ix_auth_sessions_token_hash ON auth_sessions (token_hash);

CREATE INDEX ix_auth_sessions_user_active ON auth_sessions (
    user_id, revoked_at, absolute_expires_at
);

CREATE INDEX ix_auth_sessions_user_id ON auth_sessions (user_id);

CREATE TABLE management_api_keys (
	id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	name VARCHAR(64) NOT NULL, 
	key_hash VARCHAR(64) NOT NULL, 
	key_prefix VARCHAR(16) NOT NULL, 
	scopes JSON NOT NULL, 
	expires_at DATETIME NOT NULL, 
	last_used_at DATETIME, 
	revoked_at DATETIME, 
	revision INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_management_api_keys_expires_at ON management_api_keys (expires_at);

CREATE UNIQUE INDEX ix_management_api_keys_key_hash ON management_api_keys (key_hash);

CREATE INDEX ix_management_api_keys_revoked_at ON management_api_keys (revoked_at);

CREATE INDEX ix_management_api_keys_user_id ON management_api_keys (user_id);

CREATE TABLE registration_redemptions (
	id VARCHAR(36) NOT NULL, 
	invite_id VARCHAR(36) NOT NULL, 
	user_id VARCHAR(36) NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	FOREIGN KEY(invite_id) REFERENCES registration_invite_codes (id)
);

CREATE INDEX ix_registration_redemptions_invite_id ON registration_redemptions (invite_id);

CREATE TABLE security_audit_events (
	id VARCHAR(36) NOT NULL, 
	actor_user_id VARCHAR(36), 
	target_user_id VARCHAR(36), 
	owner_user_id VARCHAR(36), 
	event_type VARCHAR(64) NOT NULL, 
	outcome VARCHAR(16) NOT NULL, 
	client_ip VARCHAR(64) NOT NULL, 
	user_agent VARCHAR(500) NOT NULL, 
	metadata_json JSON NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_user_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(target_user_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(actor_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX ix_security_audit_events_actor_user_id ON security_audit_events (actor_user_id);

CREATE INDEX ix_security_audit_events_created_at ON security_audit_events (created_at);

CREATE INDEX ix_security_audit_events_event_type ON security_audit_events (event_type);

CREATE INDEX ix_security_audit_events_outcome ON security_audit_events (outcome);

CREATE INDEX ix_security_audit_events_owner_user_id ON security_audit_events (owner_user_id);

CREATE INDEX ix_security_audit_events_target_user_id ON security_audit_events (target_user_id);
"""
