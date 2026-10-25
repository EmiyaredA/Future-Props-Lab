from db.migrations import runner
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import apply_migrations, connect_database


def test_clip_merge_upgrade_preserves_tasks_and_foreign_keys(tmp_path, monkeypatch):
    path = tmp_path / "upgrade.db"
    index = next(
        i
        for i, item in enumerate(MIGRATIONS)
        if item.migration_id == "r0110_video_editor_clip_merges"
    )
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[:index])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[index - 1].migration_id)
        apply_migrations(path)
    with connect_database(path) as connection:
        connection.execute(
            "INSERT INTO video_editor_projects (id, workspace_id, title) "
            "VALUES ('p','default','old')"
        )
        for kind in ("media", "render", "segment_export", "asset_bake"):
            connection.execute(
                "INSERT INTO video_editor_tasks "
                "(id, workspace_id, project_id, request_id, kind, snapshot_document) "
                "VALUES (?, 'default','p',?,?,'{\"kept\":true}')",
                (kind, kind, kind),
            )
        before = connection.execute("SELECT * FROM video_editor_tasks ORDER BY id").fetchall()
        connection.commit()
    apply_migrations(path)
    with connect_database(path) as connection:
        assert (
            connection.execute("SELECT * FROM video_editor_tasks ORDER BY id").fetchall() == before
        )
        connection.execute(
            "INSERT INTO video_editor_tasks (id,workspace_id,project_id,request_id,kind) "
            "VALUES ('merge','default','p','merge','clip_merge')"
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='index' "
            "AND name LIKE 'ix_video_editor_tasks_%'"
        ).fetchone() == (2,)
