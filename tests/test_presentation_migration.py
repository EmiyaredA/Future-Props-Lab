import json
import sqlite3

import pytest
from tests.presentation_helpers import sample_document

from db.migrations import apply_migrations, runner
from db.migrations.runner import connect_database


def test_presentation_migration_is_additive_and_references_cascade(tmp_path, monkeypatch):
    database = tmp_path / "presentation-migration.db"
    with monkeypatch.context() as before:
        before.setattr(runner, "MIGRATIONS", runner.MIGRATIONS[:-1])
        apply_migrations(database)
    with connect_database(database) as connection:
        existing = connection.execute("SELECT id FROM workspaces ORDER BY id").fetchall()
    apply_migrations(database)
    apply_migrations(database)
    with connect_database(database) as connection:
        assert connection.execute("SELECT id FROM workspaces ORDER BY id").fetchall() == existing
        connection.execute(
            "INSERT INTO presentation_projects VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "test",
                "default",
                "migration",
                json.dumps(sample_document().model_dump()),
                0,
                "2026-01-01",
                "2026-01-01",
            ),
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO presentation_asset_references VALUES ('test', 'missing')"
            )
        connection.execute("DELETE FROM presentation_projects WHERE id='test'")
        assert not connection.execute("PRAGMA foreign_key_check").fetchall()
