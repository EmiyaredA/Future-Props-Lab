"""Verify the final migration before any persistent desktop database uses it."""

from db.migrations import apply_migrations, runner
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import connect_database
from db.migrations.versions.r0128_local_video_providers import MIGRATION_ID


def test_local_video_upgrade_preserves_catalog_and_foreign_keys(tmp_path, monkeypatch):
    path = tmp_path / "migration.db"
    index = next(
        i for i, migration in enumerate(MIGRATIONS) if migration.migration_id == MIGRATION_ID
    )
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[:index])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[index - 1].migration_id)
        apply_migrations(path)
    with connect_database(path) as db:
        db.execute(
            "INSERT INTO model_providers(id,owner_user_id,name,kind,api_key_ciphertext) "
            "VALUES ('p','owner','Existing','openai','encrypted')"
        )
        db.execute(
            "INSERT INTO model_entries(id,owner_user_id,provider_id,slug) "
            "VALUES ('m','owner','p','existing-model')"
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
        db.executemany(
            "INSERT INTO model_providers(id,owner_user_id,name,kind) VALUES (?,'owner',?,?)",
            [
                ("tts", "Qwen", "local_qwen_tts"),
                ("relay", "RelayVSR", "local_relayvsr"),
                ("fast", "FFmpeg", "local_ffmpeg"),
            ],
        )
        db.commit()
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
