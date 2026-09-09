"""Only isolated migration databases are populated directly in these tests."""

import json

from db.migrations.runner import connect_database
from db.migrations.versions.r0044_thought_workshop import SQL as original
from db.migrations.versions.r0046_thought_knowledge_bases import SQL as upgrade
from db.migrations.versions.r0048_thought_document_tree import SQL as document_tree


def test_knowledge_migration_preserves_every_note_field_and_removes_legacy(tmp_path):
    with connect_database(tmp_path / "knowledge.db") as db:
        db.executescript(
            "CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE "
            "visual_assets(id TEXT PRIMARY KEY);"
        )
        db.executescript(original)
        db.executemany("INSERT INTO workspaces VALUES (?)", [("one",), ("two",), ("empty",)])
        db.execute("INSERT INTO visual_assets VALUES ('asset')")
        db.execute(
            "INSERT INTO thought_notebooks VALUES ('book', 'one', '研究', 9, "
            "'2026-01-01', '2026-01-02')"
        )
        document = json.dumps(
            {
                "type": "doc",
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": "原文"}]}],
            }
        )
        for rid, workspace, book, deleted in [
            ("a", "one", "book", None),
            ("b", "one", None, "2026-02-01"),
            ("c", "two", None, None),
        ]:
            db.execute(
                "INSERT INTO thought_notes VALUES (?, ?, ?, '标题', ?, 2, '原文', "
                "'[\"标签\"]', 1, 1, ?, 17, '2026-01-01', '2026-01-02')",
                (rid, workspace, book, document, deleted),
            )
        db.execute("INSERT INTO thought_note_assets VALUES ('b', 'asset')")
        db.commit()
        db.execute("PRAGMA foreign_keys=OFF")
        db.executescript(upgrade)
        db.executescript(document_tree)
        db.execute("PRAGMA foreign_keys=ON")
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert db.execute("SELECT count(*) FROM thought_knowledge_bases").fetchone()[0] == 2
        assert not db.execute(
            "SELECT name FROM sqlite_master WHERE name IN ('thought_notebooks', 'thought_folders')"
        ).fetchall()
        columns = {r[1] for r in db.execute("PRAGMA table_info(thought_notes)")}
        assert "notebook_id" not in columns and "folder_id" not in columns
        assert "parent_id" in columns
        rows = db.execute(
            "SELECT id, document, revision, tags, favorite, pinned, parent_id, "
            "deleted_at FROM thought_notes WHERE is_home=0 AND id IN ('a','b','c') ORDER BY id"
        ).fetchall()
        assert len(rows) == 3
        for row in rows:
            assert row[1:6] == (document, 17, '["标签"]', 1, 1)
        assert rows[0][6] == "book"
        assert rows[1][7] == "2026-02-01"
        book = db.execute(
            "SELECT title, parent_id, is_home FROM thought_notes WHERE id='book'"
        ).fetchone()
        assert book == ("研究", None, 0)
        assert tuple(db.execute("SELECT * FROM thought_note_assets").fetchone()) == ("b", "asset")
        assert db.execute("SELECT count(*) FROM thought_notes WHERE is_home=1").fetchone()[0] == 2
        assert (
            db.execute(
                'SELECT count(*) FROM thought_knowledge_bases WHERE workspace_id="empty"'
            ).fetchone()[0]
            == 0
        )
