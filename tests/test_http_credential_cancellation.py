import asyncio
from threading import Event

import anyio
import pytest
from fastapi import Request
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from studio.apps.identity.transport import database_auth
from studio.contracts.identity.principal import StudioPrincipal


@pytest.mark.asyncio
async def test_disconnect_during_http_credentials_returns_connection(tmp_path, monkeypatch, caplog):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'credentials.db'}", pool_size=1, max_overflow=0
    )
    sessions = async_sessionmaker(engine)
    started = anyio.Event()
    release = Event()
    loop = asyncio.get_running_loop()

    def blocked_query():
        loop.call_soon_threadsafe(started.set)
        if not release.wait(timeout=5):
            raise TimeoutError("Credential query was never released")
        return 1

    @event.listens_for(engine.sync_engine, "connect")
    def register_query(connection, _):
        connection.create_function("blocked_query", 0, blocked_query)

    async def read_principal(_request, credentials, **_kwargs):
        await credentials.execute(text("select blocked_query()"))
        return StudioPrincipal(
            user_id="owner",
            must_change_password=False,
            auth_kind="session",
            scopes=frozenset({"studio:read"}),
        )

    monkeypatch.setattr(database_auth, "_read_principal", read_principal)
    request = Request({"type": "http"})
    cancellation = anyio.CancelScope()

    async def authenticate():
        async with sessions() as business:
            with cancellation:
                await database_auth.authenticate_database_request(
                    request,
                    business,
                    sessions=sessions,
                    required_scope="studio:read",
                    allowed_origins=(),
                )
            assert "owner_user_id" not in business.info

    try:
        async with anyio.create_task_group() as tasks:
            tasks.start_soon(authenticate)
            with anyio.fail_after(5):
                await started.wait()
            cancellation.cancel()
            await anyio.sleep(0)
            release.set()
        assert cancellation.cancelled_caught
        assert not hasattr(request.state, "studio_principal")
        assert engine.pool.checkedout() == 0
        assert not any("Exception terminating connection" in row.message for row in caplog.records)
    finally:
        release.set()
        await engine.dispose()
