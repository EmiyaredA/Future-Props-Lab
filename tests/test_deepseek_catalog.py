"""Public DeepSeek workflows use authenticated API calls and mocked providers."""

import json
from contextlib import aclosing
from uuid import uuid4

import httpx
import pytest

from app.llm.providers.agent import HttpAgentAdapter
from app.llm.providers.streaming import stream_text_completion
from app.llm.providers.text import invoke_diagnostic
from test_workspace_governance import client_account

pytestmark = [pytest.mark.asyncio, pytest.mark.real_auth]


async def catalog(client):
    response = await client.get("/v1/model-providers")
    assert response.status_code == 200, response.text
    return response.json()


async def create_model(client, *, capabilities=None):
    response = await client.post(
        "/v1/model-providers",
        json={
            "expected_catalog_revision": (await catalog(client))["revision"],
            "name": "DeepSeek",
            "kind": "deepseek",
            "api_key": "deepseek-test-secret",
        },
    )
    assert response.status_code == 200, response.text
    provider = response.json()["provider"]
    assert provider["base_url"] == "https://api.deepseek.com"
    response = await client.post(
        f"/v1/model-providers/{provider['id']}/models",
        json={
            "expected_catalog_revision": response.json()["revision"],
            "slug": "deepseek-flash",
            "label": "DeepSeek Flash",
            "capabilities": capabilities or ["chat", "tools", "vision"],
        },
    )
    assert response.status_code == 200, response.text
    return provider, response.json()["model"]


async def test_catalog_crud_cas_credentials_isolation_and_availability(monkeypatch):
    from app.main import app

    monkeypatch.setattr(app.state, "desktop_enabled", True, raising=False)

    async def unexpected_request(self, **kwargs):
        del self, kwargs
        raise AssertionError("Unsupported image input must be rejected before provider invocation")
        yield  # pragma: no cover

    monkeypatch.setattr(HttpAgentAdapter, "stream_turn", unexpected_request)
    first, _, _, _ = await client_account()
    other, _, _, _ = await client_account()
    async with aclosing(first), aclosing(other):
        original = await catalog(first)
        provider, model = await create_model(first)
        current = await catalog(first)
        assert "deepseek-test-secret" not in json.dumps(current)
        assert provider["has_api_key"]
        assert current["default_model_ids"] == original["default_model_ids"]
        assert all(p["id"] != provider["id"] for p in (await catalog(other))["providers"])
        assert (
            await other.patch(
                f"/v1/model-providers/{provider['id']}",
                json={
                    "expected_catalog_revision": (await catalog(other))["revision"],
                    "name": "Foreign",
                    "kind": "deepseek",
                },
            )
        ).status_code == 404
        assert (
            await first.patch(
                f"/v1/model-providers/{provider['id']}",
                json={
                    "expected_catalog_revision": original["revision"],
                    "name": "Stale",
                    "kind": "deepseek",
                },
            )
        ).status_code == 409
        assert (
            await first.post(
                "/v1/model-providers", json={"name": "Missing revision", "kind": "deepseek"}
            )
        ).status_code == 422
        updated = await first.patch(
            f"/v1/model-providers/{provider['id']}",
            json={
                "expected_catalog_revision": current["revision"],
                "name": "Official",
                "kind": "deepseek",
                "api_key": "",
                "base_url": "https://proxy.example/v1/",
            },
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["provider"]["has_api_key"]
        assert updated.json()["provider"]["models"][0]["id"] == model["id"]
        entries = (await first.get("/v1/model-inference/options")).json()["items"]
        entry = next(item for item in entries if item["id"] == model["id"])
        assert entry["modalities"] == ["text"]
        assert entry["parameters"]["text"]["vision"]
        edited = await first.patch(
            f"/v1/model-entries/{model['id']}",
            json={
                "expected_catalog_revision": updated.json()["revision"],
                "slug": "deepseek-v4-pro",
                "label": "Pro",
                "capabilities": ["chat", "tools"],
            },
        )
        assert edited.status_code == 200, edited.text
        rejected = await first.post(
            "/v1/amadeus/model-turn",
            json={
                "model_id": model["id"],
                "system": "",
                "messages": [
                    {
                        "role": "user",
                        "text": "看图",
                        "images": [{"mime_type": "image/png", "data_base64": "aW1hZ2U="}],
                    }
                ],
            },
        )
        assert rejected.status_code == 410, rejected.text
        assert rejected.json()["code"] == "external_agent_required"
        deleted = await first.delete(
            f"/v1/model-entries/{model['id']}",
            params={"expected_catalog_revision": edited.json()["revision"]},
        )
        assert deleted.status_code == 200, deleted.text
        assert (
            await first.delete(
                f"/v1/model-providers/{provider['id']}",
                params={"expected_catalog_revision": deleted.json()["revision"]},
            )
        ).status_code == 200


async def test_diagnostic_playground_inference_and_retired_amadeus_bridge(monkeypatch):
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["authorization"] == "Bearer deepseek-test-secret"
        assert body["thinking"] == {"type": "disabled"}
        if not body.get("stream"):
            return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})
        return httpx.Response(
            200,
            text=(
                'data: {"choices":[{"delta":{"content":"答案"},"finish_reason":"stop"}]}\n\n'
                'data: {"choices":[],"usage":{"prompt_tokens":2,'
                '"completion_tokens":1,"total_tokens":3}}\n\n'
                "data: [DONE]\n\n"
            ),
        )

    transport = httpx.MockTransport(handler)

    async def diagnostic(**kwargs):
        return await invoke_diagnostic(**kwargs, transport=transport)

    def stream(**kwargs):
        kwargs.pop("transport", None)
        return stream_text_completion(**kwargs, transport=transport)

    original_init = HttpAgentAdapter.__init__

    def init(self, **kwargs):
        original_init(self, **kwargs, transport=transport)

    monkeypatch.setattr("app.llm.diagnostics.invoke_diagnostic", diagnostic)
    monkeypatch.setattr("app.llm.playground.stream.stream_text_completion", stream)
    monkeypatch.setattr("app.llm.inference.text.stream_text_completion", stream)
    monkeypatch.setattr(HttpAgentAdapter, "__init__", init)
    from app.main import app

    monkeypatch.setattr(app.state, "desktop_enabled", True, raising=False)
    client, _, _, _ = await client_account()
    async with aclosing(client):
        _, model = await create_model(client)
        response = await client.post(f"/v1/model-entries/{model['id']}/test")
        assert response.status_code == 200, response.text
        assert response.json()["output"] == "OK"
        conversation = (
            await client.post("/v1/model-test/conversations", json={"model_id": model["id"]})
        ).json()
        response = await client.post(
            f"/v1/model-test/conversations/{conversation['id']}/messages/stream",
            json={"expected_revision": conversation["revision"], "content": "你好"},
        )
        assert response.status_code == 200, response.text
        assert '"type":"done"' in response.text.replace(" ", "")
        response = await client.post(
            "/v1/model-inference/text",
            json={"model_id": model["id"], "messages": [{"role": "user", "text": "你好"}]},
        )
        assert response.status_code == 200, response.text
        assert response.json()["text"] == "答案"
        response = await client.post(
            "/v1/amadeus/model-turn/stream",
            json={
                "model_id": model["id"],
                "system": "",
                "messages": [{"role": "user", "text": "你好"}],
            },
        )
        assert response.status_code == 410, response.text
        assert response.json()["code"] == "external_agent_required"
        logs = await client.get("/v1/llm-call-logs", params={"provider_kind": "deepseek"})
        assert logs.status_code == 200, logs.text
        assert logs.json()["total"] == 3
        assert all(item["provider_kind"] == "deepseek" for item in logs.json()["items"])
        assert len(requests) == 3


@pytest.mark.parametrize("failure", ["error", "cancelled"])
async def test_tool_playground_failure_settles_partial_output_and_usage(monkeypatch, failure):
    import asyncio

    from app.capabilities.agents.harness.contracts import ModelTextDelta, ModelUsageUpdate, Usage
    from app.llm.providers.streaming import ProviderStreamError

    waiting = asyncio.Event()

    async def broken(self, **kwargs):
        del self
        if kwargs["round_index"] == 0:
            from app.capabilities.agents.harness.contracts import ModelTurnEnd, ToolCall

            yield ModelUsageUpdate(Usage(1, 1, 2))
            yield ModelUsageUpdate(Usage(2, 1, 3))
            yield ModelTurnEnd((ToolCall("call-1", kwargs["tools"][0].name, {}),), Usage(2, 1, 3))
            return
        yield ModelUsageUpdate(Usage(4, 2, 6))
        yield ModelUsageUpdate(Usage(4, 2, 6))
        yield ModelTextDelta("部分回答")
        if failure == "cancelled":
            await asyncio.Event().wait()
        raise ProviderStreamError("模型流式响应在完成前中断")

    monkeypatch.setattr(HttpAgentAdapter, "stream_turn", broken)
    client, _, _, _ = await client_account()
    async with aclosing(client):
        _, model = await create_model(client)
        tool_response = await client.post(
            "/v1/model-test/tools",
            json={
                "name": "read_" + uuid4().hex[:8],
                "description": "读取",
                "input_schema": {"type": "object", "properties": {}},
                "mock_kind": "success",
                "mock_result": {},
                "enabled": True,
            },
        )
        assert tool_response.status_code == 201, tool_response.text
        conversation = (
            await client.post("/v1/model-test/conversations", json={"model_id": model["id"]})
        ).json()
        conversation = (
            await client.patch(
                f"/v1/model-test/conversations/{conversation['id']}",
                json={
                    "expected_revision": conversation["revision"],
                    "tool_ids": [tool_response.json()["id"]],
                },
            )
        ).json()
        url = f"/v1/model-test/conversations/{conversation['id']}/messages/stream"
        body = {"expected_revision": conversation["revision"], "content": "读取"}
        if failure == "cancelled":
            from app.main import app

            async def observed_app(scope, receive, send):
                async def observe_body(message):
                    await send(message)
                    if "部分回答" in message.get("body", b"").decode():
                        waiting.set()

                await app(scope, receive, observe_body)

            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=observed_app),
                base_url="http://test",
                cookies=client.cookies,
                headers=client.headers,
            ) as streaming_client:
                task = asyncio.create_task(streaming_client.post(url, json=body))
                await asyncio.wait_for(waiting.wait(), timeout=10)
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
        else:
            response = await client.post(url, json=body)
            assert response.status_code == 200, response.text
        # Cancellation settlement is shielded and may finish after the HTTP task.
        for _ in range(50):
            response = await client.get("/v1/llm-call-logs", params={"provider_kind": "deepseek"})
            logs = response.json()
            if logs["total"]:
                break
            await asyncio.sleep(0.01)
        detail = (await client.get(f"/v1/model-test/conversations/{conversation['id']}")).json()
        assert detail["messages"][-1]["content"] == "部分回答"
        assert detail["messages"][-1]["status"] == failure
        logs = (await client.get("/v1/llm-call-logs", params={"provider_kind": "deepseek"})).json()
        assert logs["total"] == 1
        assert logs["items"][0]["status"] == "error"
        assert logs["items"][0]["total_tokens"] == 9


async def test_deepseek_role_template_can_be_saved_and_provisioned():
    admin, _, _, _ = await client_account(admin=True)
    async with aclosing(admin):
        path = "/v1/platform/model-service-templates/user"
        before = (await admin.get(path)).json()
        key = "deepseek-" + uuid4().hex
        try:
            saved = await admin.put(
                path,
                json={
                    "expected_revision": before["revision"],
                    "value": {
                        **before["value"],
                        "providers": [
                            *before["value"]["providers"],
                            {
                                "template_key": key,
                                "name": "DeepSeek 官方",
                                "kind": "deepseek",
                                "api_key": "template-secret",
                                "models": [
                                    {
                                        "template_key": key + "-model",
                                        "slug": "deepseek-flash",
                                        "capabilities": ["chat", "tools", "vision"],
                                    }
                                ],
                            },
                        ],
                    },
                },
            )
            assert saved.status_code == 200, saved.text
            assert "template-secret" not in saved.text
            member, _, _, _ = await client_account()
            async with aclosing(member):
                provider = next(
                    item
                    for item in (await catalog(member))["providers"]
                    if item["template_key"] == key
                )
                assert provider["kind"] == "deepseek"
                assert provider["base_url"] == "https://api.deepseek.com"
                assert provider["has_api_key"]
                assert provider["models"][0]["slug"] == "deepseek-flash"
        finally:
            current = (await admin.get(path)).json()
            restored = await admin.put(
                path, json={"expected_revision": current["revision"], "value": before["value"]}
            )
            assert restored.status_code == 200, restored.text
