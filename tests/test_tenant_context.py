from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import delete, select, update

from app.core.db import SessionLocal
from app.core.tenant_context import TenantScopeError, bind_workspace
from app.llm.call_logs.service import CallLogService
from app.models import LlmCallLog


def _log(log_id: str, workspace_id: str, *, model: str) -> LlmCallLog:
    return LlmCallLog(
        id=log_id,
        workspace_id=workspace_id,
        call_source="tenant-test",
        provider_kind="openai",
        model=model,
        trace_id=str(uuid4()),
        request_payload={},
        response_payload={},
        latency_ms=1,
        status="success",
    )


@pytest.mark.asyncio
async def test_bound_workspace_scopes_direct_update_and_delete() -> None:
    first_workspace = str(uuid4())
    second_workspace = str(uuid4())
    first_id = str(uuid4())
    second_id = str(uuid4())
    async with SessionLocal() as session:
        session.add_all(
            [
                _log(first_id, first_workspace, model="first"),
                _log(second_id, second_workspace, model="second"),
            ]
        )
        await session.commit()

    try:
        async with SessionLocal() as session:
            bind_workspace(session, first_workspace)
            updated = await session.execute(
                update(LlmCallLog)
                .where(LlmCallLog.id.in_([first_id, second_id]))
                .values(model="updated")
            )
            deleted = await session.execute(
                delete(LlmCallLog).where(LlmCallLog.id.in_([first_id, second_id]))
            )
            await session.commit()
            assert updated.rowcount == 1
            assert deleted.rowcount == 1

        async with SessionLocal() as session:
            remaining = await session.scalar(select(LlmCallLog).where(LlmCallLog.id == second_id))
            assert remaining is not None
            assert remaining.model == "second"
    finally:
        async with SessionLocal() as session:
            await session.execute(
                delete(LlmCallLog).where(LlmCallLog.id.in_([first_id, second_id]))
            )
            await session.commit()


@pytest.mark.asyncio
async def test_call_log_batch_delete_cannot_cross_workspace() -> None:
    first_workspace = str(uuid4())
    second_workspace = str(uuid4())
    first_id = str(uuid4())
    second_id = str(uuid4())
    async with SessionLocal() as session:
        session.add_all(
            [
                _log(first_id, first_workspace, model="first"),
                _log(second_id, second_workspace, model="second"),
            ]
        )
        await session.commit()

    try:
        async with SessionLocal() as session:
            bind_workspace(session, first_workspace)
            assert await CallLogService(session).batch_delete([first_id, second_id]) == 1

        async with SessionLocal() as session:
            assert await session.get(LlmCallLog, first_id) is None
            assert await session.get(LlmCallLog, second_id) is not None
    finally:
        async with SessionLocal() as session:
            await session.execute(
                delete(LlmCallLog).where(LlmCallLog.id.in_([first_id, second_id]))
            )
            await session.commit()


@pytest.mark.asyncio
async def test_bound_workspace_rejects_cross_workspace_orm_delete() -> None:
    first_workspace = str(uuid4())
    second_workspace = str(uuid4())
    log_id = str(uuid4())
    async with SessionLocal() as session:
        session.add(_log(log_id, second_workspace, model="second"))
        await session.commit()

    try:
        async with SessionLocal() as session:
            row = await session.get(LlmCallLog, log_id)
            assert row is not None
            bind_workspace(session, first_workspace)
            await session.delete(row)
            with pytest.raises(TenantScopeError):
                await session.commit()
            await session.rollback()

        async with SessionLocal() as session:
            assert await session.get(LlmCallLog, log_id) is not None
    finally:
        async with SessionLocal() as session:
            await session.execute(delete(LlmCallLog).where(LlmCallLog.id == log_id))
            await session.commit()
