from __future__ import annotations

import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, func, select

from app.core.credentials import encrypt_secret
from app.core.db import SessionLocal
from app.llm.playground.service import ModelTestService
from app.llm.playground.stream import generation_events
from app.llm.providers import TextDelta
from app.main import app
from app.models import (
    LlmCallLog,
    ModelEntry,
    ModelProvider,
    ModelTestConversation,
    ModelTestMessage,
)
from app.schemas.model_test import ModelTestConversationCreateIn


def _events(body: str) -> list[dict]:
    return [json.loads(line[5:].strip()) for line in body.splitlines() if line.startswith("data:")]


@pytest.mark.asyncio
async def test_persistent_playground_stream_cas_and_model_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_stream(**kwargs):
        assert kwargs["messages"][-1] == {"role": "user", "content": "你好"}
        assert kwargs["temperature"] == 0.4
        yield TextDelta(text="你")
        yield TextDelta(
            text="好",
            prompt_tokens=8,
            completion_tokens=2,
            total_tokens=10,
        )

    monkeypatch.setattr("app.llm.playground.stream.stream_text_completion", fake_stream)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        catalog = (await client.get("/v1/model-providers")).json()
        provider_response = await client.post(
            "/v1/model-providers",
            json={
                "expected_catalog_revision": catalog["revision"],
                "name": f"playground-{uuid4()}",
                "kind": "openai",
                "base_url": "https://gateway.example/v1",
                "api_key": "playground-secret",
                "enabled": True,
            },
        )
        provider_body = provider_response.json()
        provider = provider_body["provider"]
        model_response = await client.post(
            f"/v1/model-providers/{provider['id']}/models",
            json={
                "expected_catalog_revision": provider_body["revision"],
                "slug": f"chat-{uuid4()}",
                "label": "Playground Model",
                "description": "",
                "capabilities": ["chat"],
                "enabled": True,
            },
        )
        model_body = model_response.json()
        model = model_body["model"]
        created = await client.post("/v1/model-test/conversations", json={"model_id": model["id"]})
        assert created.status_code == 200, created.text
        conversation = created.json()
        patched = await client.patch(
            f"/v1/model-test/conversations/{conversation['id']}",
            json={
                "expected_revision": conversation["revision"],
                "title": "连通测试",
                "temperature": 0.4,
            },
        )
        assert patched.status_code == 200
        conversation = patched.json()

        stale = await client.patch(
            f"/v1/model-test/conversations/{conversation['id']}",
            json={"expected_revision": 0, "title": "过期修改"},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "revision_conflict"

        streamed = await client.post(
            f"/v1/model-test/conversations/{conversation['id']}/messages/stream",
            json={"expected_revision": conversation["revision"], "content": "你好"},
        )
        assert streamed.status_code == 200, streamed.text
        events = _events(streamed.text)
        assert [event["type"] for event in events] == ["start", "delta", "delta", "done"]
        assert [event["sequence"] for event in events] == [0, 1, 2, 3]
        assert all(event["schema_version"] == 2 for event in events)
        assert events[-1]["payload"]["total_tokens"] == 10

        detail = (await client.get(f"/v1/model-test/conversations/{conversation['id']}")).json()
        assert detail["revision"] == conversation["revision"] + 2
        assert [message["content"] for message in detail["messages"]] == ["你好", "你好"]
        assert detail["messages"][-1]["model_slug"] == model["slug"]

        regenerated = await client.post(
            f"/v1/model-test/conversations/{conversation['id']}/regenerate/stream",
            json={"expected_revision": detail["revision"]},
        )
        assert regenerated.status_code == 200
        regenerate_events = _events(regenerated.text)
        assert (
            regenerate_events[0]["payload"]["replaced_message_id"] == detail["messages"][-1]["id"]
        )
        assert regenerate_events[-1]["type"] == "done"
        detail = (await client.get(f"/v1/model-test/conversations/{conversation['id']}")).json()
        assistant_statuses = [
            message["status"] for message in detail["messages"] if message["role"] == "assistant"
        ]
        assert assistant_statuses == ["superseded", "completed"]

        logs = await client.get("/v1/llm-call-logs", params={"call_source": "model_playground"})
        assert logs.status_code == 200
        assert any(item["model"] == model["slug"] for item in logs.json()["items"])
        assert "playground-secret" not in logs.text

        catalog_revision = (await client.get("/v1/model-providers")).json()["revision"]
        removed = await client.delete(
            f"/v1/model-entries/{model['id']}",
            params={"expected_catalog_revision": catalog_revision},
        )
        assert removed.status_code == 200
        after_delete = (
            await client.get(f"/v1/model-test/conversations/{conversation['id']}")
        ).json()
        assert after_delete["model_id"] is None
        assert after_delete["messages"][-1]["model_slug"] == model["slug"]

        deleted = await client.delete(
            f"/v1/model-test/conversations/{conversation['id']}",
            params={"expected_revision": after_delete["revision"]},
        )
        assert deleted.status_code == 200

    async with SessionLocal() as session:
        count = int(
            (
                await session.execute(
                    select(func.count(ModelTestMessage.id)).where(
                        ModelTestMessage.conversation_id == conversation["id"]
                    )
                )
            ).scalar_one()
        )
        assert count == 0


@pytest.mark.asyncio
async def test_playground_error_is_persisted_and_logged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def failed_stream(**_kwargs):
        yield TextDelta(text="partial")
        raise httpx.ReadTimeout("slow upstream")

    monkeypatch.setattr("app.llm.playground.stream.stream_text_completion", failed_stream)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        catalog = (await client.get("/v1/model-providers")).json()
        provider_body = (
            await client.post(
                "/v1/model-providers",
                json={
                    "expected_catalog_revision": catalog["revision"],
                    "name": f"error-{uuid4()}",
                    "kind": "anthropic",
                    "base_url": "",
                    "api_key": "secret",
                    "enabled": True,
                },
            )
        ).json()
        provider = provider_body["provider"]
        model = (
            await client.post(
                f"/v1/model-providers/{provider['id']}/models",
                json={
                    "expected_catalog_revision": provider_body["revision"],
                    "slug": f"error-model-{uuid4()}",
                    "label": "",
                    "description": "",
                    "capabilities": ["chat"],
                    "enabled": True,
                },
            )
        ).json()["model"]
        conversation = (
            await client.post("/v1/model-test/conversations", json={"model_id": model["id"]})
        ).json()
        response = await client.post(
            f"/v1/model-test/conversations/{conversation['id']}/messages/stream",
            json={"expected_revision": 0, "content": "触发超时"},
        )
        events = _events(response.text)
        assert events[-1]["type"] == "error"
        assert events[-1]["payload"]["code"] == "model_timeout"
        detail = (await client.get(f"/v1/model-test/conversations/{conversation['id']}")).json()
        assert detail["messages"][-1]["status"] == "error"
        assert detail["messages"][-1]["content"] == "partial"
        log = (await client.get(f"/v1/llm-call-logs/{events[-1]['payload']['log_id']}")).json()
        assert log["status"] == "error"
        assert log["call_source"] == "model_playground"
        await client.delete(
            f"/v1/model-test/conversations/{conversation['id']}",
            params={"expected_revision": detail["revision"]},
        )
        await client.delete(f"/v1/llm-call-logs/{log['id']}")
        catalog_revision = (await client.get("/v1/model-providers")).json()["revision"]
        await client.delete(
            f"/v1/model-providers/{provider['id']}",
            params={"expected_catalog_revision": catalog_revision},
        )


@pytest.mark.asyncio
async def test_cancelled_generation_keeps_partial_reply_and_log(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entered_wait = asyncio.Event()
    never_finish = asyncio.Event()

    async def blocked_stream(**_kwargs):
        yield TextDelta(text="partial")
        entered_wait.set()
        await never_finish.wait()

    monkeypatch.setattr("app.llm.playground.stream.stream_text_completion", blocked_stream)
    provider_id = str(uuid4())
    model_id = str(uuid4())
    async with SessionLocal() as session:
        session.add(
            ModelProvider(
                id=provider_id,
                name="cancel-provider",
                kind="openai",
                api_key_ciphertext=encrypt_secret("cancel-secret"),
                enabled=True,
            )
        )
        await session.commit()
        session.add(
            ModelEntry(
                id=model_id,
                provider_id=provider_id,
                slug=f"cancel-model-{uuid4()}",
                capabilities=["chat"],
                enabled=True,
            )
        )
        await session.commit()
        conversation = await ModelTestService(session).create(
            ModelTestConversationCreateIn(model_id=model_id)
        )
        prepared = await ModelTestService(session).prepare_send(
            conversation.id, conversation.revision, "cancel me"
        )

    async def consume() -> None:
        async for _event in generation_events(prepared):
            pass

    task = asyncio.create_task(consume())
    await entered_wait.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    async with SessionLocal() as session:
        message = await session.get(ModelTestMessage, prepared.assistant_message_id)
        assert message is not None
        assert message.status == "cancelled"
        assert message.content == "partial"
        log = (
            (
                await session.execute(
                    select(LlmCallLog).where(
                        LlmCallLog.call_source == "model_playground",
                        LlmCallLog.model == prepared.model_slug,
                    )
                )
            )
            .scalars()
            .one()
        )
        assert log.status == "error"
        assert log.error_message == "用户停止生成"
        await session.execute(delete(LlmCallLog).where(LlmCallLog.id == log.id))
        await session.execute(
            delete(ModelTestConversation).where(ModelTestConversation.id == conversation.id)
        )
        await session.execute(delete(ModelProvider).where(ModelProvider.id == provider_id))
        await session.commit()
