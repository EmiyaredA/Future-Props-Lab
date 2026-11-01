"""The additive inspection column preserves old output rows and foreign keys."""

from db.migrations import runner
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import apply_migrations, connect_database


def test_inspection_migration_keeps_existing_outputs(tmp_path, monkeypatch):
    path = tmp_path / "inspection.db"
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[:-1])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[-2].migration_id)
        apply_migrations(path)
    with connect_database(path) as connection:
        connection.executescript("""
        INSERT INTO visual_workshop_projects
          (id, title, kind, status, revision, created_at, updated_at, workspace_id)
        VALUES ('legacy-project', 'Legacy', 'canvas', 'draft', 0,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'default');
        INSERT INTO visual_node_outputs
          (id, project_id, node_id, version, kind, text, source, source_key,
          input_snapshot, is_final, created_at)
        VALUES ('legacy-output', 'legacy-project', 'node', 1, 'text', 'preserved',
          'text', 'legacy', '[]', 1, CURRENT_TIMESTAMP);
        """)
    apply_migrations(path)
    with connect_database(path) as connection:
        row = connection.execute(
            "SELECT text, inspection_asset_id FROM visual_node_outputs WHERE id='legacy-output'"
        ).fetchone()
        assert tuple(row) == ("preserved", None)
        assert not connection.execute("PRAGMA foreign_key_check").fetchall()
    assert apply_migrations(path)[1] is False
