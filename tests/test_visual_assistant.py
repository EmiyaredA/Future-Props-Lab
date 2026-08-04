from __future__ import annotations

import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select

from app.core.credentials import encrypt_secret
from app.core.db import SessionLocal
from app.llm.providers import TextDelta
from app.main import app
from app.models import LlmCallLog, ModelEntry, ModelProvider
from app.visual_workshop import assistant_stream


@pytest.mark.asyncio
async def test_visual_assistant_project_chat_stream_context_assets_and_cas(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = ModelProvider(
        id=str(uuid4()),
        name="视觉工坊对话测试",
        kind="openai",
        base_url="https://assistant.example.test/v1",
        api_key_ciphertext=encrypt_secret("test-only-secret"),
        enabled=True,
        sort_order=-100,
    )
    text_model = ModelEntry(
        id=str(uuid4()),
        provider_id=provider.id,
        slug="assistant-text-test",
        label="Assistant Text Test",
        description="确定性测试模型",
        capabilities=["chat"],
        enabled=True,
        sort_order=0,
    )
    vision_model = ModelEntry(
        id=str(uuid4()),
        provider_id=provider.id,
        slug="assistant-vision-test",
        label="Assistant Vision Test",
        description="确定性视觉测试模型",
        capabilities=["chat", "vision"],
        enabled=True,
        sort_order=1,
    )
    async with SessionLocal() as session:
        session.add(provider)
        await session.commit()
    async with SessionLocal() as session:
        session.add_all([text_model, vision_model])
        await session.commit()

    captured: dict[str, object] = {}

    async def fake_stream(**kwargs):
        captured.update(kwargs)
        yield TextDelta(text="画布")
        yield TextDelta(
            text="建议",
            prompt_tokens=12,
            completion_tokens=2,
            total_tokens=14,
        )

    monkeypatch.setattr(assistant_stream, "stream_text_completion", fake_stream)
    transport = httpx.ASGITransport(app=app)
    project_ids: list[str] = []
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        try:
            for title in ("对话项目", "其他项目"):
                response = await client.post(
                    "/v1/visual-workshop/projects",
                    json={"title": title, "kind": "canvas"},
                )
                assert response.status_code == 200, response.text
                project_ids.append(response.json()["id"])

            long_text = "灵感" * 2500
            canvas = await client.put(
                f"/v1/visual-workshop/projects/{project_ids[0]}/canvas",
                json={
                    "expected_revision": 0,
                    "nodes": [
                        {
                            "id": "text-1",
                            "kind": "text",
                            "title": "长文本",
                            "position": {"x": 20, "y": 30},
                            "text": long_text,
                        }
                    ],
                },
            )
            assert canvas.status_code == 200, canvas.text

            created = await client.post(
                f"/v1/visual-workshop/projects/{project_ids[0]}/conversations"
            )
            assert created.status_code == 200, created.text
            conversation = created.json()
            assert conversation["model_id"] == text_model.id
            assert conversation["title"] == "AI 助手对话"

            listed = await client.get(
                f"/v1/visual-workshop/projects/{project_ids[0]}/conversations"
            )
            assert [item["id"] for item in listed.json()["items"]] == [conversation["id"]]
            other_list = await client.get(
                f"/v1/visual-workshop/projects/{project_ids[1]}/conversations"
            )
            assert other_list.json() == {"items": []}
            model_options = await client.get(
                f"/v1/visual-workshop/projects/{project_ids[0]}/conversations/models"
            )
            assert model_options.status_code == 200
            assert [item["id"] for item in model_options.json()["items"]] == [
                text_model.id,
                vision_model.id,
            ]
            assert model_options.json()["items"][1]["provider_name"] == provider.name
            assert "vision" in model_options.json()["items"][1]["capabilities"]

            renamed = await client.patch(
                f"/v1/visual-workshop/projects/{project_ids[0]}/conversations/{conversation['id']}",
                json={"expected_revision": 0, "title": "画布讨论"},
            )
            assert renamed.status_code == 200
            conversation = renamed.json()
            selected_vision = await client.patch(
                f"/v1/visual-workshop/projects/{project_ids[0]}/conversations/{conversation['id']}",
                json={
                    "expected_revision": conversation["revision"],
                    "model_id": vision_model.id,
                },
            )
            assert selected_vision.status_code == 200
            assert selected_vision.json()["model_id"] == vision_model.id
            selected_text = await client.patch(
                f"/v1/visual-workshop/projects/{project_ids[0]}/conversations/{conversation['id']}",
                json={
                    "expected_revision": selected_vision.json()["revision"],
                    "model_id": text_model.id,
                },
            )
            assert selected_text.status_code == 200
            conversation = selected_text.json()
            unavailable = await client.patch(
                f"/v1/visual-workshop/projects/{project_ids[0]}/conversations/{conversation['id']}",
                json={
                    "expected_revision": conversation["revision"],
                    "model_id": str(uuid4()),
                },
            )
            assert unavailable.status_code == 409
            assert unavailable.json()["code"] == "model_unavailable"
            stale = await client.patch(
                f"/v1/visual-workshop/projects/{project_ids[0]}/conversations/{conversation['id']}",
                json={"expected_revision": 0, "title": "静默覆盖"},
            )
            assert stale.status_code == 409
            assert stale.json()["current"]["title"] == "画布讨论"

            image = await client.post(
                "/v1/files",
                data={"project_id": project_ids[0]},
                files={
                    "upload": (
                        "reference.png",
                        b"\x89PNG\r\n\x1a\nassistant-reference",
                        "image/png",
                    )
                },
            )
            assert image.status_code == 200, image.text
            image = image.json()

            streamed = await client.post(
                f"/v1/visual-workshop/projects/{project_ids[0]}/conversations/"
                f"{conversation['id']}/messages/stream",
                json={
                    "expected_revision": conversation["revision"],
                    "content": "请分析当前画布",
                    "asset_ids": [image["id"]],
                },
            )
            assert streamed.status_code == 200, streamed.text
            frames = [
                json.loads(line[5:])
                for line in streamed.text.splitlines()
                if line.startswith("data:")
            ]
            assert [frame["type"] for frame in frames] == [
                "start",
                "delta",
                "delta",
                "done",
            ]
            assert frames[0]["payload"]["model"] == vision_model.slug
            assert frames[0]["payload"]["model_changed_from"] == text_model.slug
            assert frames[-1]["payload"]["message"]["content"] == "画布建议"
            assert "不能直接修改画布" in str(captured["system_prompt"])
            assert "text_truncated" in str(captured["system_prompt"])
            assert len(captured["messages"]) == 1

            detail = await client.get(
                f"/v1/visual-workshop/projects/{project_ids[0]}/conversations/{conversation['id']}"
            )
            assert detail.status_code == 200
            detail_json = detail.json()
            assert detail_json["revision"] == 5
            assert [message["role"] for message in detail_json["messages"]] == [
                "user",
                "assistant",
            ]
            assert detail_json["messages"][0]["assets"][0]["id"] == image["id"]

            blocked_delete = await client.delete(
                f"/v1/files/{image['id']}",
                params={"expected_revision": image["revision"]},
            )
            assert blocked_delete.status_code == 409
            assert blocked_delete.json()["code"] == "asset_in_use"

            other_image = await client.post(
                "/v1/files",
                data={"project_id": project_ids[1]},
                files={
                    "upload": (
                        "other.png",
                        b"\x89PNG\r\n\x1a\nother-reference",
                        "image/png",
                    )
                },
            )
            assert other_image.status_code == 200
            scope_mismatch = await client.post(
                f"/v1/visual-workshop/projects/{project_ids[0]}/conversations/"
                f"{conversation['id']}/messages/stream",
                json={
                    "expected_revision": detail_json["revision"],
                    "content": "跨项目图片",
                    "asset_ids": [other_image.json()["id"]],
                },
            )
            assert scope_mismatch.status_code == 422
            assert scope_mismatch.json()["code"] == "scope_mismatch"

            async with SessionLocal() as session:
                log = await session.scalar(
                    select(LlmCallLog)
                    .where(LlmCallLog.call_source == "visual_workshop_assistant")
                    .order_by(LlmCallLog.created_at.desc())
                )
                assert log is not None
                serialized = json.dumps(log.request_payload)
                assert "test-only-secret" not in serialized
                assert "base64" not in serialized
                assert log.request_payload["asset_ids"] == [image["id"]]
                assert "不能直接修改画布" in log.request_payload["system"]
                assert log.request_payload["messages"][-1] == {
                    "role": "user",
                    "content": "请分析当前画布",
                    "attachments": [
                        {
                            "mime_type": "image/png",
                            "byte_size": image["byte_size"],
                        }
                    ],
                }
                assert log.response_payload == {
                    "content": "画布建议",
                    "status": "completed",
                }
        finally:
            for project_id in project_ids:
                await client.delete(
                    f"/v1/visual-workshop/projects/{project_id}",
                    params={"expected_revision": 0},
                )

    async with SessionLocal() as session:
        await session.execute(delete(ModelProvider).where(ModelProvider.id == provider.id))
        await session.commit()


@pytest.mark.asyncio
async def test_visual_assistant_preserves_a_draft_without_an_enabled_chat_model() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post(
                "/v1/visual-workshop/projects",
                json={"title": "无模型项目", "kind": "canvas"},
            )
        ).json()
        try:
            created = await client.post(
                f"/v1/visual-workshop/projects/{project['id']}/conversations"
            )
            assert created.status_code == 200
            assert created.json()["model_id"] is None
            response = await client.post(
                f"/v1/visual-workshop/projects/{project['id']}/conversations/"
                f"{created.json()['id']}/messages/stream",
                json={
                    "expected_revision": 0,
                    "content": "保留这条草稿",
                    "asset_ids": [],
                },
            )
            assert response.status_code == 409
            assert response.json()["code"] == "model_unavailable"
        finally:
            await client.delete(
                f"/v1/visual-workshop/projects/{project['id']}",
                params={"expected_revision": 0},
            )
