"""Verify the final migration before any persistent desktop database uses it."""

from db.migrations import apply_migrations, runner
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import connect_database


def test_local_tts_upgrade_preserves_catalog_and_foreign_keys(tmp_path, monkeypatch):
    path = tmp_path / "migration.db"
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
        before = db.execute("SELECT * FROM model_providers WHERE id='p'").fetchone()
        indexes = db.execute(
            "SELECT name,sql FROM sqlite_master WHERE type='index' "
            "AND tbl_name='model_providers' ORDER BY name"
        ).fetchall()
        db.commit()
    apply_migrations(path)
    with connect_database(path) as db:
        assert db.execute("SELECT * FROM model_providers WHERE id='p'").fetchone() == before
        assert (
            db.execute(
                "SELECT name,sql FROM sqlite_master WHERE type='index' "
                "AND tbl_name='model_providers' ORDER BY name"
            ).fetchall()
            == indexes
        )
        assert db.execute("SELECT provider_id FROM model_entries WHERE id='m'").fetchone() == ("p",)
        db.execute(
            "INSERT INTO model_providers(id,name,kind) VALUES ('local','Local','local_qwen_tts')"
        )
        db.commit()
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
