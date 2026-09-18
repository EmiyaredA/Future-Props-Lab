from __future__ import annotations

import asyncio
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select
from tests.test_account_system import create_test_account, login_and_change_password, unsafe_headers
from tests.thought_helpers import delete_note

from app.apps.thought_workshop.assistant import PreparedWriting, writing_events
from app.llm.providers.streaming import TextDelta
from app.main import app
from app.llm.models import LlmCallLog
from app.runtime.db import SessionLocal

ROOT = "/v1/thought-workshop"


@pytest.mark.real_auth
@pytest.mark.asyncio
async def test_notes_and_knowledge_bases_are_isolated_and_require_write_auth():
    transport = httpx.ASGITransport(app=app)
    account_a = await create_test_account()
    account_b = await create_test_account()
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as a,
        httpx.AsyncClient(transport=transport, base_url="http://test") as b,
    ):
        assert (await a.get(ROOT + "/notes")).status_code == 401
        await login_and_change_password(a, *account_a)
        await login_and_change_password(b, *account_b)
        assert (await a.post(ROOT + "/notes", json={})).status_code == 403
        book = (
            await a.post(
                ROOT + "/knowledge-bases", headers=unsafe_headers(a), json={"title": "私有空间"}
            )
        ).json()
        response = await a.post(
            ROOT + "/notes",
            headers=unsafe_headers(a),
            json={
                "title": "隔离笔记",
                "knowledge_base_id": book["id"],
                "expected_knowledge_revision": 0,
            },
        )
        assert response.status_code == 200, response.text
        note = response.json()
        assert (await b.get(ROOT + f"/notes/{note['id']}")).status_code == 404
        assert (await b.get(ROOT + "/knowledge-bases")).json() == []
        assert (
            await b.post(
                ROOT + "/notes",
                headers=unsafe_headers(b),
                json={"knowledge_base_id": book["id"], "expected_knowledge_revision": 0},
            )
        ).status_code == 404
        assert (
            await delete_note(
                b,
                ROOT + f"/notes/{note['id']}",
                headers=unsafe_headers(b),
                params={"expected_revision": 0},
            )
        ).status_code == 404
        rejected = await a.post(
            ROOT + "/notes", headers=unsafe_headers(a), json={"workspace_id": "other"}
        )
        assert rejected.status_code == 422


def prepared() -> PreparedWriting:
    return PreparedWriting(
        "default",
        str(uuid4()),
        0,
        "openai",
        "https://example.com",
        "",
        "mock-model",
        "summary",
        "",
        "只用于确定性测试",
    )


@pytest.mark.asyncio
async def test_assistant_stream_and_logs_use_normalized_events(monkeypatch):
    async def fake(**_kwargs):
        yield TextDelta(text="摘要")
        yield TextDelta(text="内容", prompt_tokens=8, completion_tokens=2, total_tokens=10)

    monkeypatch.setattr("app.apps.thought_workshop.assistant.stream_text_completion", fake)
    request = prepared()
    result = b"".join([chunk async for chunk in writing_events(request)]).decode()
    assert '"type": "delta"' in result and '"type": "complete"' in result
    async with SessionLocal() as session:
        logs = (
            await session.scalars(
                select(LlmCallLog).where(LlmCallLog.call_source == "thought_workshop_assistant")
            )
        ).all()
        log = next(row for row in logs if row.request_payload["note_id"] == request.note_id)
        assert log.total_tokens == 10 and log.status == "success"
        assert "只用于确定性测试" not in str(log.request_payload)


@pytest.mark.asyncio
async def test_assistant_error_is_redacted_and_cancellation_settles(monkeypatch):
    async def broken(**_kwargs):
        raise RuntimeError("secret-provider-token")
        yield TextDelta()

    monkeypatch.setattr("app.apps.thought_workshop.assistant.stream_text_completion", broken)
    output = b"".join([chunk async for chunk in writing_events(prepared())]).decode()
    assert '"type": "error"' in output and "secret-provider-token" not in output
    entered = asyncio.Event()

    async def pending(**_kwargs):
        entered.set()
        await asyncio.Event().wait()
        yield TextDelta()

    monkeypatch.setattr("app.apps.thought_workshop.assistant.stream_text_completion", pending)
    request = prepared()

    async def consume():
        return [chunk async for chunk in writing_events(request)]

    task = asyncio.create_task(consume())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    async with SessionLocal() as session:
        logs = (
            await session.scalars(
                select(LlmCallLog).where(LlmCallLog.call_source == "thought_workshop_assistant")
            )
        ).all()
        assert (
            next(
                row for row in logs if row.request_payload["note_id"] == request.note_id
            ).response_payload["status"]
            == "cancelled"
        )
