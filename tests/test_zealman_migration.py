from pathlib import Path

from tests.migration_fixtures import MIGRATIONS, apply_migrations

from db.migrations import runner
from db.migrations.runner import connect_database


def test_zealman_upgrade_preserves_connections_tasks_assets_and_foreign_keys(
    tmp_path: Path, monkeypatch
):
    database = tmp_path / "upgrade.db"
    target = next(
        i
        for i, migration in enumerate(MIGRATIONS)
        if migration.migration_id == "0091_zealman_video"
    )
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[:target])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[target - 1].migration_id)
        apply_migrations(database)
    with connect_database(database) as connection:
        connection.execute(
            "INSERT INTO model_providers (id, name, kind, api_key_ciphertext) VALUES "
            "('old-provider', 'Existing', 'senseaudio_video', 'encrypted-key')"
        )
        connection.execute(
            "INSERT INTO model_entries (id, provider_id, slug) VALUES ('old-model', "
            "'old-provider', 'old-video')"
        )
        connection.execute(
            "INSERT INTO model_test_generation_tasks (id, provider_id, model_id, "
            "provider_kind, generation_kind, provider_name, model_slug, "
            "provider_task_id, status) VALUES ('old-task', 'old-provider', "
            "'old-model', 'senseaudio_video', 'video', 'Existing', 'old-video', "
            "'remote-task', 'pending')"
        )
        connection.execute(
            "INSERT INTO model_test_generation_assets "
            "(id, task_id, role, position, original_filename, storage_key, media_kind, "
            "mime_type, byte_size) VALUES "
            "('old-reference', 'old-task', 'reference_image', 0, 'original.png', "
            "'private-storage-key', 'image', 'image/png', 123)"
        )
        before_reference = connection.execute(
            "SELECT * FROM model_test_generation_assets WHERE id='old-reference'"
        ).fetchone()
        before_provider = connection.execute(
            "SELECT * FROM model_providers WHERE id='old-provider'"
        ).fetchone()
        before_task = connection.execute(
            "SELECT * FROM model_test_generation_tasks WHERE id='old-task'"
        ).fetchone()
        before_indexes = connection.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name IN "
            "('model_providers', 'model_test_generation_tasks') ORDER BY name"
        ).fetchall()
        connection.commit()
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[: target + 1])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[target].migration_id)
        apply_migrations(database)
    with connect_database(database) as connection:
        assert (
            connection.execute("SELECT * FROM model_providers WHERE id='old-provider'").fetchone()
            == before_provider
        )
        assert (
            connection.execute(
                "SELECT * FROM model_test_generation_tasks WHERE id='old-task'"
            ).fetchone()
            == before_task
        )
        assert (
            connection.execute(
                "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name "
                "IN ('model_providers', 'model_test_generation_tasks') ORDER BY name"
            ).fetchall()
            == before_indexes
        )
        assert (
            connection.execute(
                "SELECT * FROM model_test_generation_assets WHERE id='old-reference'"
            ).fetchone()
            == before_reference
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert all(
            "r0091_old" not in sql
            for (sql,) in connection.execute("SELECT sql FROM sqlite_master WHERE type='table'")
        )
        connection.execute(
            "INSERT INTO model_providers (id, name, kind) VALUES ('new-provider', "
            "'ZEALMAN', 'zealman_video')"
        )
        connection.execute(
            "INSERT INTO model_test_generation_tasks (id, provider_id, provider_kind, "
            "generation_kind, provider_name, model_slug, status) VALUES ('new-task', "
            "'new-provider', 'zealman_video', 'video', 'ZEALMAN', 'U06-9图3音频-V5', "
            "'queued')"
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
