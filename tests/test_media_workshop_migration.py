from pathlib import Path

from tests.migration_fixtures import LATEST_MIGRATION_ID, MIGRATIONS, apply_migrations

from db.migrations.runner import connect_database, ensure_registry, migration_checksum


def _create_r0037_database(database_path: Path) -> None:
    migration_count = next(
        index
        for index, migration in enumerate(MIGRATIONS)
        if migration.migration_id == "r0038_media_workshop_tasks_and_audio"
    )
    with connect_database(database_path) as connection:
        ensure_registry(connection)
        for migration in MIGRATIONS[:migration_count]:
            if migration.foreign_keys_off:
                connection.execute("PRAGMA foreign_keys = OFF")
            connection.executescript(migration.sql)
            connection.execute(
                "INSERT INTO schema_migrations (migration_id, checksum) VALUES (?, ?)",
                (migration.migration_id, migration_checksum(migration)),
            )
            connection.commit()
            if migration.foreign_keys_off:
                connection.execute("PRAGMA foreign_keys = ON")


def test_r0038_completes_the_early_r0037_canvas_upgrade(tmp_path: Path) -> None:
    database_path = tmp_path / "r0037-upgrade.db"
    _create_r0037_database(database_path)

    with connect_database(database_path) as connection:
        stored_r0037 = connection.execute(
            "SELECT checksum FROM schema_migrations WHERE migration_id = ?",
            ("r0037_media_workshop_upgrade",),
        ).fetchone()
        before_video_tasks = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'video_editor_tasks'"
        ).fetchone()[0]
        assert stored_r0037 == ("63a43031252d328100a2ebfe18855579b00f603cdc52bb42bcb59b07cbb8aa90",)
        assert "segment_export" not in before_video_tasks

    assert apply_migrations(database_path) == (LATEST_MIGRATION_ID, True)

    with connect_database(database_path) as connection:
        video_tasks = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'video_editor_tasks'"
        ).fetchone()[0]
        generation_tasks = connection.execute(
            "SELECT sql FROM sqlite_master "
            "WHERE type = 'table' AND name = 'visual_generation_tasks'"
        ).fetchone()[0]
        providers = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'model_providers'"
        ).fetchone()[0]
        canvas_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(visual_canvas_documents)")
        }
        assert "segment_export" in video_tasks
        assert "senseaudio_music" in generation_tasks
        assert "generation_kind IN ('image', 'video', 'audio')" in generation_tasks
        assert "senseaudio_sfx" in providers
        assert "edges" in canvas_columns
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
