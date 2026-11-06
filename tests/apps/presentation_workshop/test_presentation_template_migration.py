import itertools
import json

from db.migrations import runner
from db.migrations.runner import connect_database
from tests.migration_fixtures import apply_migrations
from tests.presentation_helpers import sample_document


def test_additive_template_migration_preserves_documents_and_revision(tmp_path, monkeypatch):
    database = tmp_path / "templates.db"
    with monkeypatch.context() as before:
        before.setattr(
            runner,
            "MIGRATIONS",
            tuple(
                itertools.takewhile(
                    lambda m: m.migration_id != "r0111_presentation_templates", runner.MIGRATIONS
                )
            ),
        )
        apply_migrations(database)
    original = json.dumps(sample_document().model_dump())
    with connect_database(database) as connection:
        connection.execute(
            "INSERT INTO presentation_projects VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("preserve", "default", "unchanged", original, 9, "2026-01-01", "2026-01-01"),
        )
        connection.commit()
    apply_migrations(database)
    apply_migrations(database)
    with connect_database(database) as connection:
        assert connection.execute(
            "SELECT document, revision FROM presentation_projects WHERE id='preserve'"
        ).fetchone() == (original, 9)
        names = {
            r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert {
            "presentation_templates",
            "presentation_examples",
            "presentation_template_assets",
            "presentation_example_assets",
        } <= names
        assert not connection.execute("PRAGMA foreign_key_check").fetchall()
