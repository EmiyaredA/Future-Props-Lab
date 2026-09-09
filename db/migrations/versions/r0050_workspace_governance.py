MIGRATION_ID = "r0050_workspace_governance"

SQL = """
CREATE TABLE workspace_memberships_next (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, workspace_id)
);
INSERT INTO workspace_memberships_next SELECT * FROM workspace_memberships;
DROP TABLE workspace_memberships;
ALTER TABLE workspace_memberships_next RENAME TO workspace_memberships;
CREATE UNIQUE INDEX uq_workspace_membership_active_owner
  ON workspace_memberships(workspace_id) WHERE role = 'owner' AND status = 'active';
CREATE INDEX ix_workspace_memberships_user_status ON workspace_memberships(user_id, status);
ALTER TABLE workspace_invitations ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'member'
  CHECK (role IN ('admin', 'member', 'viewer'));
"""
