from __future__ import annotations

import json
from uuid import uuid4

import httpx
import pytest

from app.capabilities.agents.harness import ModelTextDelta, ModelTurnEnd, ToolCall, Usage
from app.main import app


def _events(body: str) -> list[dict]:
    return [json.loads(line[5:].strip()) for line in body.splitlines() if line.startswith("data:")]


@pytest.mark.asyncio
async def test_model_test_tool_crud_dry_run_cas_and_binding() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/v1/model-test/tools",
            json={
                "name": f"get_weather_{uuid4().hex[:8]}",
                "description": "查询天气",
                "input_schema": {
                    "type": "object",
                    "properties": {"city": {"type": "string"}},
                    "required": ["city"],
                },
                "mock_kind": "success",
                "mock_result": {"weather": "晴", "temperature": 26},
                "delay_ms": 5,
                "enabled": True,
            },
        )
        assert created.status_code == 201, created.text
        tool = created.json()
        assert tool["parameter_count"] == 1

        invalid = await client.post(
            f"/v1/model-test/tools/{tool['id']}/execute",
            json={"expected_revision": tool["revision"], "input": {}},
        )
        assert invalid.status_code == 422
        assert invalid.json()["code"] == "invalid_tool_input"

        executed = await client.post(
            f"/v1/model-test/tools/{tool['id']}/execute",
            json={"expected_revision": tool["revision"], "input": {"city": "上海"}},
        )
        assert executed.status_code == 200, executed.text
        assert executed.json()["success"] is True
        assert executed.json()["result"]["weather"] == "晴"
        assert executed.json()["configured_delay_ms"] == 5

        updated = await client.patch(
            f"/v1/model-test/tools/{tool['id']}",
            json={
                "expected_revision": tool["revision"],
                "name": tool["name"],
                "description": tool["description"],
                "input_schema": tool["input_schema"],
                "mock_kind": "failure",
                "mock_result": {},
                "error_code": "weather_down",
                "error_message": "天气服务不可用",
                "delay_ms": 0,
                "enabled": True,
            },
        )
        assert updated.status_code == 200
        assert updated.json()["revision"] == 1
        failed = await client.post(
            f"/v1/model-test/tools/{tool['id']}/execute",
            json={"expected_revision": 1, "input": {"city": "上海"}},
        )
        assert failed.status_code == 200
        assert failed.json()["status"] == "failed"
        assert failed.json()["error_code"] == "weather_down"
        stale = await client.patch(
            f"/v1/model-test/tools/{tool['id']}",
            json={
                "expected_revision": 0,
                "name": tool["name"],
                "description": tool["description"],
                "input_schema": tool["input_schema"],
                "mock_kind": "failure",
                "mock_result": {},
                "error_code": "weather_down",
                "error_message": "天气服务不可用",
                "delay_ms": 0,
                "enabled": True,
            },
        )
        assert stale.status_code == 409

        catalog = (await client.get("/v1/model-test/tools")).json()
        assert catalog["overview"]["today_runs"] >= 1
        assert any(item["id"] == tool["id"] for item in catalog["items"])


@pytest.mark.asyncio
async def test_model_test_tool_rejects_duplicates_invalid_schema_and_size() -> None:
    name = f"validation_{uuid4().hex[:8]}"
    body = {
        "name": name,
        "description": "校验工具",
        "input_schema": {"type": "object", "properties": {}},
        "mock_kind": "success",
        "mock_result": {},
        "delay_ms": 0,
        "enabled": True,
    }
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.post("/v1/model-test/tools", json=body)).status_code == 201
        duplicate = await client.post("/v1/model-test/tools", json=body)
        assert duplicate.status_code == 409
        invalid_schema = await client.post(
            "/v1/model-test/tools",
            json={**body, "name": f"schema_{name}", "input_schema": {"type": "array"}},
        )
        assert invalid_schema.status_code == 422
        oversized = await client.post(
            "/v1/model-test/tools",
            json={**body, "name": f"size_{name}", "mock_result": "x" * 65536},
        )
        assert oversized.status_code == 422
        invalid_delay = await client.post(
            "/v1/model-test/tools", json={**body, "name": f"delay_{name}", "delay_ms": 10001}
        )
        assert invalid_delay.status_code == 422


@pytest.mark.parametrize("provider_kind", ["openai", "anthropic"])
@pytest.mark.asyncio
async def test_model_test_conversation_runs_selected_mock_tool(
    monkeypatch, provider_kind: str
) -> None:
    calls = 0

    async def fake_turn(self, **kwargs):
        nonlocal calls
        del self
        assert kwargs["tools"][0].name.startswith("lookup_city_")
        if calls == 0:
            calls += 1
            yield ModelTurnEnd(
                (ToolCall("call-1", kwargs["tools"][0].name, {"city": "上海"}),),
                Usage(4, 1, 5),
            )
        else:
            yield ModelTextDelta("上海今天晴朗。")
            yield ModelTurnEnd((), Usage(5, 4, 9))

    monkeypatch.setattr("app.llm.providers.agent.HttpAgentAdapter.stream_turn", fake_turn)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        catalog = (await client.get("/v1/model-providers")).json()
        provider_result = await client.post(
            "/v1/model-providers",
            json={
                "expected_catalog_revision": catalog["revision"],
                "name": f"tools-provider-{uuid4()}",
                "kind": provider_kind,
                "base_url": "https://gateway.example/v1",
                "api_key": "test-key",
                "enabled": True,
            },
        )
        provider = provider_result.json()
        model_result = await client.post(
            f"/v1/model-providers/{provider['provider']['id']}/models",
            json={
                "expected_catalog_revision": provider["revision"],
                "slug": f"tools-model-{uuid4()}",
                "label": "Tools Model",
                "description": "",
                "capabilities": ["chat", "tools"],
                "enabled": True,
            },
        )
        model = model_result.json()["model"]
        tool_result = await client.post(
            "/v1/model-test/tools",
            json={
                "name": f"lookup_city_{uuid4().hex[:8]}",
                "description": "查询城市",
                "input_schema": {
                    "type": "object",
                    "properties": {"city": {"type": "string"}},
                    "required": ["city"],
                },
                "mock_kind": "success",
                "mock_result": {"weather": "晴"},
                "delay_ms": 0,
                "enabled": True,
            },
        )
        tool = tool_result.json()
        conversation = (
            await client.post("/v1/model-test/conversations", json={"model_id": model["id"]})
        ).json()
        bound = await client.patch(
            f"/v1/model-test/conversations/{conversation['id']}",
            json={"expected_revision": conversation["revision"], "tool_ids": [tool["id"]]},
        )
        assert bound.status_code == 200, bound.text
        conversation = bound.json()
        streamed = await client.post(
            f"/v1/model-test/conversations/{conversation['id']}/messages/stream",
            json={"expected_revision": conversation["revision"], "content": "上海天气如何"},
        )
        assert streamed.status_code == 200, streamed.text
        events = _events(streamed.text)
        assert "step" in [event["type"] for event in events]
        assert events[-1]["type"] == "done"
        detail = (await client.get(f"/v1/model-test/conversations/{conversation['id']}")).json()
        assistant = detail["messages"][-1]
        assert assistant["content"] == "上海今天晴朗。"
        assert assistant["tool_calls"][0]["arguments"] == {"city": "上海"}
        assert assistant["tool_calls"][0]["result"] == {"weather": "晴"}

        blocked = await client.delete(
            f"/v1/model-test/tools/{tool['id']}",
            params={"expected_revision": tool["revision"]},
        )
        assert blocked.status_code == 409
        assert blocked.json()["code"] == "tool_in_use"

        catalog_revision = (await client.get("/v1/model-providers")).json()["revision"]
        assert (
            await client.delete(
                f"/v1/model-entries/{model['id']}",
                params={"expected_catalog_revision": catalog_revision},
            )
        ).status_code == 200
        current = (await client.get(f"/v1/model-test/conversations/{conversation['id']}")).json()
        assert (
            await client.delete(
                f"/v1/model-test/conversations/{conversation['id']}",
                params={"expected_revision": current["revision"]},
            )
        ).status_code == 200
        assert (
            await client.delete(
                f"/v1/model-test/tools/{tool['id']}",
                params={"expected_revision": tool["revision"]},
            )
        ).status_code == 200
        catalog_revision = (await client.get("/v1/model-providers")).json()["revision"]
        assert (
            await client.delete(
                f"/v1/model-providers/{provider['provider']['id']}",
                params={"expected_catalog_revision": catalog_revision},
            )
        ).status_code == 200
