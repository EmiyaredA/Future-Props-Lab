from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from tests.migration_fixtures import LATEST_MIGRATION_ID, MIGRATIONS, apply_migrations

from db.migrations import runner
from db.migrations.runner import connect_database


def test_skill_description_upgrade_preserves_records_and_constraints(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database = tmp_path / "skill-upgrade.db"
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[:-1])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[-2].migration_id)
        apply_migrations(database)
    with connect_database(database) as connection:
        connection.execute(
            "INSERT INTO integration_skills "
            "(id,workspace_id,name,description,default_version,latest_version,"
            "enabled,revision,tags) "
            "VALUES ('skill','default','existing','original','v1','v2',1,7,'[\"设计\"]')"
        )
        for version in ("v1", "v2"):
            connection.execute(
                "INSERT INTO integration_skill_versions "
                "(id,skill_id,version,name,description,storage_path,content_sha256,"
                "file_count,expanded_bytes) "
                "VALUES (?, 'skill', ?, 'existing', ?, ?, ?, 173, 27648351)",
                (version, version, f"original {version}", f"/retained/{version}", "a" * 64),
            )
        before = {
            table: connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
            for table in ("integration_skills", "integration_skill_versions")
        }
        connection.commit()

    assert apply_migrations(database) == (LATEST_MIGRATION_ID, True)
    assert apply_migrations(database) == (LATEST_MIGRATION_ID, False)
    with connect_database(database) as connection:
        for table, rows in before.items():
            assert connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall() == rows
            columns = {row[1]: row[2] for row in connection.execute(f"PRAGMA table_info({table})")}
            assert columns["description"] == "VARCHAR(4000)"
        for table, expected in (
            ("integration_skills", "ix_integration_skills_workspace"),
            ("integration_skill_versions", "ix_integration_skill_versions_skill"),
        ):
            assert expected in {row[1] for row in connection.execute(f"PRAGMA index_list({table})")}
        connection.execute("UPDATE integration_skills SET description=?", ("完整" * 2000,))
        connection.execute("UPDATE integration_skill_versions SET description=?", ("全" * 4000,))
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO integration_skills (id,workspace_id,name) "
                "VALUES ('duplicate','default','existing')"
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO integration_skill_versions "
                "(id,skill_id,version,name,storage_path,content_sha256,file_count,expanded_bytes) "
                "SELECT 'duplicate',skill_id,version,name,storage_path,content_sha256,"
                "file_count,expanded_bytes FROM integration_skill_versions WHERE id='v1'"
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("UPDATE integration_skill_versions SET skill_id='missing'")
        connection.execute("DELETE FROM integration_skills WHERE id='skill'")
        assert connection.execute("SELECT count(*) FROM integration_skill_versions").fetchone() == (
            0,
        )
