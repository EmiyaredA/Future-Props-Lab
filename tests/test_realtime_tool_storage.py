from __future__ import annotations

import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest

from db.migrations import apply_migrations
from db.migrations.registry import LATEST_MIGRATION_ID, MIGRATIONS
from db.migrations.runner import connect_database, ensure_registry, migration_checksum


def _create_database_before(database_path: Path, migration_id: str) -> None:
    count = next(
        index
        for index, migration in enumerate(MIGRATIONS)
        if migration.migration_id == migration_id
    )
    with connect_database(database_path) as connection:
        ensure_registry(connection)
        for migration in MIGRATIONS[:count]:
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


def test_r0034_preserves_tool_calls_and_allows_realtime_source(tmp_path: Path) -> None:
    database_path = tmp_path / "r0033-realtime-tools-upgrade.db"
    _create_database_before(database_path, "r0034_realtime_tool_calls")
    historical_id = str(uuid4())
    with connect_database(database_path) as connection:
        connection.execute(
            """
            INSERT INTO model_test_tool_calls (
              id, workspace_id, source, action_id, run_id, tool_name,
              definition_snapshot, arguments, status, success, result
            ) VALUES (?, 'default', 'dry_run', 'historical', 'run-before',
                      'legacy_tool', '{}', '{}', 'completed', TRUE, '{}')
            """,
            (historical_id,),
        )
        connection.commit()

    assert apply_migrations(database_path) == (LATEST_MIGRATION_ID, True)
    with connect_database(database_path) as connection:
        assert connection.execute(
            "SELECT source, action_id, status FROM model_test_tool_calls WHERE id = ?",
            (historical_id,),
        ).fetchone() == ("dry_run", "historical", "completed")
        connection.execute(
            """
            INSERT INTO model_test_tool_calls (
              id, workspace_id, source, action_id, run_id, tool_name,
              definition_snapshot, arguments, status
            ) VALUES (?, 'default', 'realtime_voice', 'call-1', 'voice-run',
                      'weather', '{}', '{}', 'running')
            """,
            (str(uuid4()),),
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO model_test_tool_calls (
                  id, workspace_id, source, action_id, tool_name,
                  definition_snapshot, arguments, status
                ) VALUES (?, 'default', 'unsupported', 'bad', 'bad_tool',
                          '{}', '{}', 'running')
                """,
                (str(uuid4()),),
            )
