import sqlite3

import pytest

from db.migrations import apply_migrations, runner
from db.migrations.runner import connect_database
from db.migrations.versions.r0050_workspace_governance import SQL


def test_upgrade_preserves_memberships_and_enforces_roles(tmp_path, monkeypatch):
    database = tmp_path / "governance.db"
    with monkeypatch.context() as historical:
        historical.setattr(
            runner,
            "MIGRATIONS",
            tuple(m for m in runner.MIGRATIONS if m.migration_id != "r0050_workspace_governance"),
        )
        apply_migrations(database)
    with connect_database(database) as connection:
        connection.execute(
            "INSERT INTO users (id, username, username_normalized, password_hash) "
            "VALUES ('owner', 'owner', 'owner', 'test'), ('member', 'member', 'member', 'test')"
        )
        connection.execute(
            "INSERT INTO workspace_memberships (id, user_id, workspace_id, role, revision) "
            "VALUES ('o', 'owner', 'default', 'owner', 4), ('m', 'member', 'default', 'member', 7)"
        )
        before = [tuple(row) for row in connection.execute("SELECT * FROM workspace_memberships")]
        # Always construct the historical schema before applying this migration.
        columns = {row[1] for row in connection.execute("PRAGMA table_info(workspace_invitations)")}
        assert "role" not in columns
        connection.execute(
            "INSERT INTO workspace_invitations (id, workspace_id, invitee_user_id, "
            "invited_by_user_id, expires_at, revision) "
            "VALUES ('invite', 'default', 'member', 'owner', '2099-01-01', 3)"
        )
        connection.executescript(SQL)
        assert tuple(
            connection.execute(
                "SELECT role, revision FROM workspace_invitations WHERE id='invite'"
            ).fetchone()
        ) == ("member", 3)
        assert [
            tuple(row) for row in connection.execute("SELECT * FROM workspace_memberships")
        ] == before
        for role in ("admin", "viewer", "member"):
            connection.execute("UPDATE workspace_memberships SET role=? WHERE id='m'", (role,))
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("UPDATE workspace_memberships SET role='owner' WHERE id='m'")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("UPDATE workspace_memberships SET role='unknown' WHERE id='m'")
        assert not connection.execute("PRAGMA foreign_key_check").fetchall()
