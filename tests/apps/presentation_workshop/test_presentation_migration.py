import itertools
import json
import sqlite3

import pytest

from db.migrations import runner
from db.migrations.runner import connect_database
from tests.migration_fixtures import apply_migrations
from tests.presentation_helpers import sample_document


def test_presentation_migration_is_additive_and_references_cascade(tmp_path, monkeypatch):
    database = tmp_path / "presentation-migration.db"
    with monkeypatch.context() as before:
        # Everything from the presentation workshop onward stays pending, so later
        # migrations keep their ordered prerequisites instead of a hand-kept list.
        before.setattr(
            runner,
            "MIGRATIONS",
            tuple(
                itertools.takewhile(
                    lambda m: m.migration_id != "0056_presentation_workshop",
                    runner.MIGRATIONS,
                )
            ),
        )
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
