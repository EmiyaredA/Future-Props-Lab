"""Models schema has only owned relationships; the recovery schema keeps its history."""

import sqlite3

import pytest
from sqlalchemy import select

from app.llm.models import ModelInferenceTask, ModelTestTranscriptionTask, RuntimeAdmission
from db.migrations import apply_migrations
from fpl_models.catalog_migration import ModelsImportReceipt
from fpl_models.migrations.registry import MIGRATIONS
from fpl_models.models import ACCOUNT_MODELS, MODELS
from fpl_runtime.database import Database
from fpl_runtime.migrations import apply, check


def test_models_migration_appends_owned_tables_without_external_schemas(tmp_path):
    path = tmp_path / "service.db"
    apply(path, "models", MIGRATIONS[:1])
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        first = db.execute("SELECT * FROM _fpl_service_schema").fetchone()
    apply(path, "models", MIGRATIONS)
    apply(path, "models", MIGRATIONS)
    check(path, "models", MIGRATIONS)
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        assert db.execute("SELECT * FROM _fpl_service_schema ORDER BY position").fetchone() == first
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables == {model.__tablename__ for model in (*MODELS, ModelsImportReceipt)} | {
            "_fpl_service_schema"
        }
        assert ModelsImportReceipt not in MODELS
        assert not {
            "users",
            "visual_assets",
            "platform_settings",
            "visual_generation_tasks",
        }.intersection(tables)
        for table in tables:
            assert all(
                row[2] in tables for row in db.execute(f'PRAGMA foreign_key_list("{table}")')
            )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    with pytest.raises(ValueError, match="归属"):
        apply(path, "identity", MIGRATIONS)


def test_recovery_schema_retains_registered_external_constraints(tmp_path):
    path = tmp_path / "legacy.db"
    apply_migrations(path)
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        for table, field, target in (
            ("model_inference_tasks", "owner_user_id", "users"),
            ("model_inference_assets", "owner_user_id", "users"),
            ("model_test_transcription_tasks", "source_asset_id", "visual_assets"),
            ("runtime_admissions", "queue_task_id", "visual_generation_tasks"),
        ):
            keys = list(db.execute(f'PRAGMA foreign_key_list("{table}")'))
            assert any(row[2] == target and row[3] == field for row in keys)


async def test_models_records_accept_external_identifiers_without_identity_or_asset_tables(
    tmp_path,
):
    path = tmp_path / "service.db"
    apply(path, "models", MIGRATIONS)
    database = Database("models", tmp_path, models=MODELS, account_models=ACCOUNT_MODELS)
    try:
        async with database.sessions(info={"owner_user_id": "alpha"}) as session:
            session.add(
                ModelInferenceTask(
                    owner_user_id="alpha",
                    request_id="request",
                    fingerprint="f" * 64,
                    provider_kind="openai",
                    provider_name="fixture",
                    model_slug="fixture",
                    kind="image",
                )
            )
            session.add(
                ModelTestTranscriptionTask(
                    owner_user_id="alpha",
                    provider_kind="senseaudio_asr",
                    provider_name="fixture",
                    model_slug="fixture",
                    source_kind="library",
                    source_asset_id="external-asset",
                    input_storage_key="input",
                    input_filename="fixture.wav",
                    input_mime_type="audio/wav",
                    input_byte_size=100,
                )
            )
            session.add(
                RuntimeAdmission(
                    user_id="alpha",
                    owner_user_id="alpha",
                    platform_role="user",
                    queue_task_id="external-workshop-task",
                )
            )
            await session.commit()
        async with database.sessions(info={"owner_user_id": "alpha"}) as session:
            assert len(list(await session.scalars(select(ModelInferenceTask)))) == 1
            assert (
                await session.scalar(select(ModelTestTranscriptionTask))
            ).source_asset_id == "external-asset"
            assert (
                await session.scalar(select(RuntimeAdmission))
            ).queue_task_id == "external-workshop-task"
        async with database.sessions(info={"owner_user_id": "beta"}) as session:
            assert list(await session.scalars(select(ModelInferenceTask))) == []
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        await database.close()
