"""Validate the new migration against an isolated previous-version database."""

from db.migrations.registry import MIGRATIONS
from db.migrations.runner import connect_database
from db.migrations.versions.r0049_thought_history import SQL


def test_history_migration_preserves_baseline(tmp_path):
    with connect_database(tmp_path / "history.db") as db:
        db.execute("PRAGMA foreign_keys=OFF")
        for migration in MIGRATIONS:
            if migration.migration_id == "0049_thought_history":
                break
            db.executescript(migration.sql)
        db.execute("INSERT INTO workspaces(id, name) VALUES ('w', 'test')")
        db.execute(
            "INSERT INTO thought_knowledge_bases(id, workspace_id, title, description, "
            "revision, created_at, updated_at) VALUES ('k','w','test','',0,"
            "'2026-01-01','2026-01-01')"
        )
        db.execute(
            "INSERT INTO thought_notes(id, workspace_id, knowledge_base_id, title, document, "
            "search_text, tags, revision, created_at, updated_at) VALUES "
            "('n','w','k','保留标题','{\"type\":\"doc\",\"content\":[]}', '', '[]',7,"
            "'2026-01-01','2026-01-02')"
        )
        db.commit()
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript(SQL)
        assert db.execute(
            "SELECT note_id, revision, title, author_id, source FROM thought_note_history"
        ).fetchone() == ("n", 7, "保留标题", None, "baseline")
        assert not db.execute("PRAGMA foreign_key_check(thought_note_history)").fetchall()
        assert not db.execute("PRAGMA foreign_key_check(thought_history_assets)").fetchall()
        db.execute("DELETE FROM thought_notes WHERE id='n'")
        assert db.execute("SELECT count(*) FROM thought_note_history").fetchone()[0] == 0
