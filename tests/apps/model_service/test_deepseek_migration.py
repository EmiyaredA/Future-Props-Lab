"""All direct database construction here is limited to temporary migration fixtures."""

import sqlite3

import pytest

from db.migrations import runner
from db.migrations.runner import connect_database
from tests.migration_fixtures import MIGRATIONS, apply_migrations


def test_upgrade_preserves_catalog_credentials_indexes_and_references(tmp_path, monkeypatch):
    path = tmp_path / "upgrade.db"
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[:-1])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[-2].migration_id)
        apply_migrations(path)
    with connect_database(path) as db:
        db.execute(
            "INSERT INTO model_providers(id,name,kind,api_key_ciphertext) "
            "VALUES ('p','Existing','openai','encrypted')"
        )
        db.execute(
            "INSERT INTO model_entries(id,provider_id,slug) VALUES ('m','p','existing-model')"
        )
        before = db.execute("SELECT * FROM model_providers ORDER BY id").fetchall()
        indexes = db.execute(
            "SELECT name,sql FROM sqlite_master WHERE type='index' "
            "AND tbl_name='model_providers' ORDER BY name"
        ).fetchall()
        db.commit()
    apply_migrations(path)
    with connect_database(path) as db:
        assert db.execute("SELECT * FROM model_providers ORDER BY id").fetchall() == before
        assert (
            db.execute(
                "SELECT name,sql FROM sqlite_master WHERE type='index' "
                "AND tbl_name='model_providers' ORDER BY name"
            ).fetchall()
            == indexes
        )
        assert db.execute("SELECT provider_id FROM model_entries WHERE id='m'").fetchone() == ("p",)
        db.execute("INSERT INTO model_providers(id,name,kind) VALUES ('ds','DeepSeek','deepseek')")
        db.commit()
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert apply_migrations(path)[1] is False


def test_fresh_database_accepts_deepseek_but_rejects_unknown_kind(tmp_path):
    path = tmp_path / "fresh.db"
    apply_migrations(path)
    with connect_database(path) as db:
        db.execute("INSERT INTO model_providers(id,name,kind) VALUES ('ds','DeepSeek','deepseek')")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO model_providers(id,name,kind) VALUES ('bad','Unknown','unknown')"
            )
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
