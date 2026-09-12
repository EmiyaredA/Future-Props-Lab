"""Preserve the SQL checksum first applied to existing standalone-inference databases."""

from dataclasses import replace
from pathlib import Path

import pytest

from db.migrations import MigrationDriftError, apply_migrations, check_migrations, runner
from db.migrations.registry import LATEST_MIGRATION_ID, MIGRATIONS
from db.migrations.runner import connect_database, migration_checksum

APPLIED_INFERENCE_CHECKSUM = "9c7dcccf24f9fb18f500aba9ba87d97cf4d2f5d16e2e8e37fe61cc7ec6295974"


def test_inference_migration_preserves_original_sql_bytes() -> None:
    migration = next(m for m in MIGRATIONS if m.migration_id == "0060_model_inference")
    assert migration_checksum(migration) == APPLIED_INFERENCE_CHECKSUM


def test_restarting_existing_inference_database_keeps_history(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database = tmp_path / "inference.db"
    assert apply_migrations(database) == (LATEST_MIGRATION_ID, True)
    with connect_database(database) as connection:
        before = connection.execute("SELECT * FROM schema_migrations ORDER BY rowid").fetchall()
        inference = next(row for row in before if row[0] == "0060_model_inference")
        assert inference[1] == APPLIED_INFERENCE_CHECKSUM

    assert check_migrations(database) == LATEST_MIGRATION_ID
    assert apply_migrations(database) == (LATEST_MIGRATION_ID, False)
    with connect_database(database) as connection:
        assert (
            connection.execute("SELECT * FROM schema_migrations ORDER BY rowid").fetchall()
            == before
        )

    # The rejected formatting change remains a drift; never relax checksum verification.
    changed = tuple(
        replace(
            m,
            sql=m.sql.replace(
                "ix_model_inference_tasks_workspace_status ON",
                "ix_model_inference_tasks_workspace_status\n ON",
            ),
        )
        if m.migration_id == "0060_model_inference"
        else m
        for m in MIGRATIONS
    )
    monkeypatch.setattr(runner, "MIGRATIONS", changed)
    with pytest.raises(MigrationDriftError, match="0060_model_inference"):
        apply_migrations(database)
    with connect_database(database) as connection:
        assert (
            connection.execute("SELECT * FROM schema_migrations ORDER BY rowid").fetchall()
            == before
        )
