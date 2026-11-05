"""Integration schema evolves independently and has only owned foreign keys."""

import sqlite3

import pytest
from sqlalchemy import select

from studio.apps.integrations.records import ExternalExecution
from studio.apps.integrations.storage.migrations.registry import MIGRATIONS
from studio.apps.integrations.storage.service_models import MODELS
from studio.runtime.database.migrations import apply, check
from studio.runtime.database.sessions import Database, ServiceStorageError


def test_integrations_append_only_owned_schema_has_no_foreign_service_tables(tmp_path):
    path = tmp_path / "service.db"
    apply(path, "integrations", MIGRATIONS[:1])
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        first = db.execute("SELECT * FROM _fpl_service_schema ORDER BY position").fetchone()
    apply(path, "integrations", MIGRATIONS)
    apply(path, "integrations", MIGRATIONS)
    check(path, "integrations", MIGRATIONS)
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        assert db.execute("SELECT * FROM _fpl_service_schema ORDER BY position").fetchone() == first
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables == {model.__tablename__ for model in MODELS} | {"_fpl_service_schema"}
        assert not tables.intersection(
            {"users", "visual_assets", "runtime_admissions", "thought_notes"}
        )
        for table in tables:
            assert all(
                row[2] in tables for row in db.execute(f'PRAGMA foreign_key_list("{table}")')
            )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    before = path.read_bytes()
    with pytest.raises(ValueError, match="归属"):
        apply(path, "models", MIGRATIONS)
    assert path.read_bytes() == before


async def test_external_task_account_reference_does_not_need_identity_or_thought_tables(tmp_path):
    apply(tmp_path / "service.db", "integrations", MIGRATIONS)
    db = Database("integrations", tmp_path, models=MODELS)
    try:
        async with db.sessions(info={"owner_user_id": "alpha"}) as session:
            session.add(
                ExternalExecution(
                    task_id="external-thought-task",
                    owner_user_id="alpha",
                    intent_id="external-identity-intent",
                    input_sha256="a" * 64,
                    connection_id="external-reference",
                    connection_revision=4,
                    document_id="Doc123",
                    payload={},
                    checkpoint={},
                )
            )
            await session.commit()
        async with db.sessions(info={"owner_user_id": "beta"}) as session:
            assert list(await session.scalars(select(ExternalExecution))) == []
        async with db.sessions() as session:
            with pytest.raises(ServiceStorageError, match="账号"):
                await session.scalars(select(ExternalExecution))
    finally:
        await db.close()
