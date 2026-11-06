"""Public DeepSeek workflows use authenticated API calls and mocked providers."""

import json
from contextlib import aclosing
from uuid import uuid4

import httpx
import pytest

from studio.apps.model_service.providers.agent import HttpAgentAdapter
from studio.apps.model_service.providers.streaming import stream_text_completion
from studio.apps.model_service.providers.text import invoke_diagnostic
from tests.apps.visual_workshop.test_workspace_governance import client_account

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
    from website_test_support import app

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

    monkeypatch.setattr("studio.apps.model_service.diagnostics.invoke_diagnostic", diagnostic)
    monkeypatch.setattr(
        "studio.apps.model_service.playground.stream.stream_text_completion", stream
    )
    monkeypatch.setattr("studio.apps.model_service.inference.text.stream_text_completion", stream)
    monkeypatch.setattr(HttpAgentAdapter, "__init__", init)
    from website_test_support import app

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
