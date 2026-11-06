from db.migrations import runner
from db.migrations.runner import connect_database
from tests.migration_fixtures import MIGRATIONS, apply_migrations


def test_autodl_upgrade_preserves_history_metadata_indexes_and_references(tmp_path, monkeypatch):
    database = tmp_path / "autodl-upgrade.db"
    target = next(
        i for i, migration in enumerate(MIGRATIONS) if migration.migration_id == "0113_autodl_video"
    )
    previous = MIGRATIONS[:target]
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", previous)
        patch.setattr(runner, "LATEST_MIGRATION_ID", previous[-1].migration_id)
        apply_migrations(database)
    tables = (
        "model_providers",
        "model_entries",
        "model_test_generation_tasks",
        "model_test_generation_assets",
        "visual_generation_tasks",
    )
    with connect_database(database) as db:
        db.execute(
            "INSERT INTO model_providers (id, name, kind, api_key_ciphertext) VALUES "
            "('p', 'Existing', 'senseaudio_video', 'encrypted')"
        )
        db.execute(
            "INSERT INTO model_entries (id, provider_id, slug) VALUES ('m', 'p', 'existing')"
        )
        db.execute(
            "INSERT INTO visual_workshop_projects (id, title, kind) VALUES ('project', "
            "'Existing', 'video')"
        )
        db.execute(
            "INSERT INTO model_test_generation_tasks (id, provider_id, model_id, "
            "provider_kind, generation_kind, provider_name, model_slug, "
            "provider_task_id, request_payload, execution_info, status) VALUES ('t', "
            "'p', 'm', 'senseaudio_video', 'video', 'Existing', 'existing', 'remote', "
            "'{\"duration\":5}', '{\"phase\":\"queued\"}', 'pending')"
        )
        db.execute(
            "INSERT INTO visual_generation_tasks (id, project_id, provider_id, "
            "model_id, provider_kind, generation_kind, provider_name, model_slug, "
            "provider_task_id, execution_info, status) VALUES ('v', 'project', 'p', "
            "'m', 'senseaudio_video', 'video', 'Existing', 'existing', 'remote-v', "
            "'{\"phase\":\"running\"}', 'processing')"
        )
        db.execute(
            "INSERT INTO model_test_generation_assets (id, task_id, role, position, "
            "original_filename, storage_key, media_kind, mime_type, byte_size) VALUES "
            "('a', 't', 'reference_image', 0, 'ref.png', 'ref', 'image', 'image/png', "
            "123)"
        )
        columns = {
            table: ",".join(row[1] for row in db.execute(f"PRAGMA table_info({table})"))
            for table in tables
        }
        before = {
            table: db.execute(f"SELECT {columns[table]} FROM {table}").fetchall()
            for table in tables
        }
        indexes = db.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name IN "
            "('model_providers', 'model_test_generation_tasks', "
            "'visual_generation_tasks') ORDER BY name"
        ).fetchall()
        db.commit()
    apply_migrations(database)
    with connect_database(database) as db:
        assert {
            table: db.execute(f"SELECT {columns[table]} FROM {table}").fetchall()
            for table in tables
        } == before
        assert (
            db.execute(
                "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name IN "
                "('model_providers', 'model_test_generation_tasks', "
                "'visual_generation_tasks') ORDER BY name"
            ).fetchall()
            == indexes
        )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        for table in ("model_providers", "model_test_generation_tasks", "visual_generation_tasks"):
            db.execute(
                f"UPDATE {table} SET "
                f"{'kind' if table == 'model_providers' else 'provider_kind'}='autodl_video'"
            )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert not any(
            "r0113_old" in (row[0] or "") for row in db.execute("SELECT sql FROM sqlite_master")
        )
