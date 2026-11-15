"""Upgrade only the task kind constraint; preserve account data and references."""

from db.migrations import runner
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import apply_migrations, connect_database


def test_preview_task_upgrade_preserves_rows_indexes_and_foreign_keys(tmp_path, monkeypatch):
    path = tmp_path / "preview-upgrade.db"
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[:-1])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[-2].migration_id)
        apply_migrations(path)
    with connect_database(path) as db:
        db.execute(
            "INSERT INTO users (id,username,username_normalized,password_hash) "
            "VALUES ('owner','preview','preview','isolated')"
        )
        db.execute(
            "INSERT INTO video_editor_projects (id,owner_user_id,title) "
            "VALUES ('project','owner','Preview')"
        )
        for kind in ("media", "render", "segment_export", "asset_bake", "clip_merge"):
            db.execute(
                "INSERT INTO video_editor_tasks "
                "(id,owner_user_id,project_id,request_id,kind,snapshot_document) "
                "VALUES (?,'owner','project',?,?,?)",
                (kind, kind, kind, '{"frozen":true}'),
            )
        before = db.execute("SELECT * FROM video_editor_tasks ORDER BY id").fetchall()
        db.commit()
    apply_migrations(path)
    with connect_database(path) as db:
        assert db.execute("SELECT * FROM video_editor_tasks ORDER BY id").fetchall() == before
        db.execute(
            "INSERT INTO video_editor_tasks (id,owner_user_id,project_id,request_id,kind) "
            "VALUES ('preview','owner','project','preview','preview_render')"
        )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert db.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='index' "
            "AND name LIKE 'ix_video_editor_tasks_%'"
        ).fetchone() == (2,)
        db.execute("DELETE FROM video_editor_projects WHERE id='project'")
        assert db.execute("SELECT count(*) FROM video_editor_tasks").fetchone() == (0,)
