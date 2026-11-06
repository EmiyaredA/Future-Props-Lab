"""Streaming completion and cancellation settle only in the supplied guarded database."""

import ast
import asyncio
from pathlib import Path

import pytest
from sqlalchemy import select

from studio.apps.model_service.inference.text import events
from studio.apps.model_service.providers.streaming import TextDelta
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.contracts.model_service.credential_snapshot import CredentialSnapshot
from studio.contracts.model_service.schemas.model_inference import InferenceTextIn
from studio.runtime.database.orm_base import Base
from studio.runtime.database.sessions import Database


def test_model_execution_modules_do_not_import_the_monolith_session_factory():
    root = Path(__file__).resolve().parents[3] / "backend/studio/apps/model_service"
    for path in root.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            imports = (
                [node.module]
                if isinstance(node, ast.ImportFrom)
                else [alias.name for alias in node.names]
                if isinstance(node, ast.Import)
                else []
            )
            assert "studio.runtime.database.website" not in imports, path


@pytest.fixture
async def databases(tmp_path):
    databases = [
        Database("models", tmp_path / name, models=(LlmCallLog,)) for name in ("first", "second")
    ]
    for database in databases:
        database.root.mkdir()
        async with database.engine.begin() as connection:
            await connection.run_sync(
                lambda c: Base.metadata.create_all(c, tables=[LlmCallLog.__table__])
            )
    try:
        yield databases
    finally:
        await asyncio.gather(*(database.close() for database in databases))


def body():
    return InferenceTextIn(model_id="fixture", messages=[{"role": "user", "text": "hello"}])


async def logs(database):
    async with database.sessions(info={"allow_system_reads": True}) as session:
        return list(await session.scalars(select(LlmCallLog)))


async def test_parallel_streams_write_to_separate_factories_with_explicit_account_binding(
    databases, monkeypatch
):
    async def provider(**_kwargs):
        yield TextDelta(text="owned result", total_tokens=3, finish_reason="stop")

    monkeypatch.setattr("studio.apps.model_service.inference.text.stream_text_completion", provider)

    async def consume(owner, database):
        return [
            event
            async for event in events(
                owner,
                body(),
                {"kind": "openai", "model": "fixture"},
                session_factory=database.sessions,
                credential=CredentialSnapshot(auth_kind="session"),
            )
        ]

    output = await asyncio.gather(consume("alpha", databases[0]), consume("beta", databases[1]))
    assert all(
        stream[-1].type == "done" and stream[-1].result.text == "owned result" for stream in output
    )
    for database, owner in zip(databases, ("alpha", "beta"), strict=True):
        rows = await logs(database)
        assert len(rows) == 1 and rows[0].owner_user_id == owner
        assert rows[0].status == "success" and rows[0].total_tokens == 3
        assert rows[0].auth_kind == "session"


async def test_closing_a_stream_settles_one_failure_in_its_own_database(databases):
    stream = events(
        "alpha",
        body(),
        {"kind": "openai", "model": "fixture"},
        session_factory=databases[0].sessions,
    )
    assert (await anext(stream)).type == "start"
    await stream.aclose()
    rows = await logs(databases[0])
    assert len(rows) == 1 and rows[0].owner_user_id == "alpha"
    assert rows[0].status == "error" and rows[0].error_message == "客户端断开，调用已停止"
    assert await logs(databases[1]) == []
