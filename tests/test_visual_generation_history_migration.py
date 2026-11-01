import json
from pathlib import Path

from tests.migration_fixtures import LATEST_MIGRATION_ID, MIGRATIONS, apply_migrations

from db.migrations.runner import connect_database, ensure_registry, migration_checksum


def _create_pre_history_database(database_path: Path) -> None:
    migration_count = next(
        index
        for index, migration in enumerate(MIGRATIONS)
        if migration.migration_id == "r0039_visual_generation_node_history"
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


def test_r0039_backfills_only_the_current_canvas_task_and_adds_history_index(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "visual-history-upgrade.db"
    _create_pre_history_database(database_path)
    now = "2026-08-03 08:00:00"

    with connect_database(database_path) as connection:
        connection.execute(
            """
            INSERT INTO visual_workshop_projects
              (id, workspace_id, title, kind, status, revision, created_at, updated_at)
            VALUES ('project-1', 'workspace-1', '历史项目', 'canvas', 'draft', 0, ?, ?)
            """,
            (now, now),
        )
        for task_id in ("task-old", "task-current"):
            connection.execute(
                """
                INSERT INTO visual_generation_tasks
                  (id, workspace_id, project_id, provider_id, model_id, provider_kind,
                   generation_kind, provider_name, model_slug, request_payload,
                   provider_task_id, status, progress, error_message, result_url,
                   result_asset_id, revision, created_at, updated_at, completed_at)
                VALUES (?, 'workspace-1', 'project-1', NULL, NULL, 'senseaudio_image',
                        'image', '测试服务商', 'image-pro', '{}', NULL, 'completed',
                        100, NULL, NULL, NULL, 0, ?, ?, ?)
                """,
                (task_id, now, now, now),
            )
        connection.execute(
            """
            INSERT INTO visual_canvas_documents
              (project_id, nodes, edges, revision, updated_at)
            VALUES ('project-1', ?, '[]', 1, ?)
            """,
            (
                json.dumps(
                    [
                        {
                            "id": "image-node-1",
                            "kind": "image",
                            "generation_task_id": "task-current",
                        }
                    ]
                ),
                now,
            ),
        )
        connection.commit()

    assert apply_migrations(database_path) == (LATEST_MIGRATION_ID, True)

    with connect_database(database_path) as connection:
        rows = connection.execute(
            "SELECT id, canvas_node_id FROM visual_generation_tasks ORDER BY id"
        ).fetchall()
        indexes = {
            row[1] for row in connection.execute("PRAGMA index_list(visual_generation_tasks)")
        }
        assert rows == [
            ("task-current", "image-node-1"),
            ("task-old", None),
        ]
        assert "ix_visual_generation_tasks_project_canvas_node_created" in indexes
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
