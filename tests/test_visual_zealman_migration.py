from db.migrations import apply_migrations, runner
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import connect_database


def test_visual_workflow_upgrade_preserves_history_indexes_and_foreign_keys(tmp_path, monkeypatch):
    path = tmp_path / "visual-upgrade.db"
    target = next(
        i for i, m in enumerate(MIGRATIONS) if m.migration_id == "0092_visual_zealman_video"
    )
    previous = MIGRATIONS[:target]
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", previous)
        patch.setattr(runner, "LATEST_MIGRATION_ID", previous[-1].migration_id)
        apply_migrations(path)
    with connect_database(path) as db:
        db.execute(
            "INSERT INTO visual_workshop_projects (id, title, kind) VALUES ('p', 'P', 'video')"
        )
        db.execute(
            "INSERT INTO model_providers (id, name, kind) VALUES ('z', 'Z', 'zealman_video')"
        )
        db.execute(
            "INSERT INTO visual_generation_tasks (id, project_id, provider_kind, generation_kind, "
            "provider_name, model_slug, provider_task_id, request_payload, status) "
            "VALUES ('t', 'p', 'senseaudio_video', 'video', 'Existing', 'existing', 'remote', "
            "'{\"prompt\":\"existing\"}', 'pending')"
        )
        before = db.execute("SELECT * FROM visual_generation_tasks").fetchall()
        indexes = db.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='index' "
            "AND tbl_name='visual_generation_tasks' ORDER BY name"
        ).fetchall()
        db.commit()
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[: target + 1])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[target].migration_id)
        apply_migrations(path)
    with connect_database(path) as db:
        assert db.execute("SELECT * FROM visual_generation_tasks").fetchall() == before
        assert (
            db.execute(
                "SELECT name, sql FROM sqlite_master WHERE type='index' "
                "AND tbl_name='visual_generation_tasks' ORDER BY name"
            ).fetchall()
            == indexes
        )
        db.execute(
            "INSERT INTO visual_generation_tasks (id, project_id, provider_id, provider_kind, "
            "generation_kind, provider_name, model_slug, status) VALUES "
            "('new', 'p', 'z', 'zealman_video', 'video', 'Z', 'U06-9图3音频-V5', 'queued')"
        )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert all(
            "r0092_old" not in row[0]
            for row in db.execute("SELECT sql FROM sqlite_master WHERE type='table'")
        )
        db.execute("DELETE FROM visual_workshop_projects WHERE id='p'")
        assert db.execute("SELECT COUNT(*) FROM visual_generation_tasks").fetchone() == (0,)
