from __future__ import annotations

import io
import zipfile
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, select

from app.core.db import SessionLocal
from app.llm.providers import DiagnosticResult
from app.main import app
from app.models import LlmCallLog, ModelProvider
from db.migrations.registry import LATEST_MIGRATION_ID


@pytest.mark.asyncio
async def test_cors_exposes_download_filenames() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health", headers={"Origin": "http://127.0.0.1:3000"})
    exposed = response.headers.get("access-control-expose-headers", "").lower()
    assert "content-disposition" in exposed


@pytest.mark.asyncio
async def test_ready_rejects_unhealthy_background_runners() -> None:
    previous = getattr(app.state, "runner_supervisor", None)
    app.state.runner_supervisor = SimpleNamespace(is_healthy=False)
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/ready")
        assert response.status_code == 503
    finally:
        app.state.runner_supervisor = previous


@pytest.mark.asyncio
async def test_model_catalog_diagnostic_and_logs(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_diagnostic(**kwargs) -> DiagnosticResult:
        assert kwargs["api_key"] == "sk-integration-secret"
        return DiagnosticResult(
            output="OK",
            response_payload={"choices": [{"message": {"content": "OK"}}]},
            prompt_tokens=5,
            completion_tokens=1,
            total_tokens=6,
        )

    monkeypatch.setattr("app.llm.diagnostics.invoke_diagnostic", fake_diagnostic)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/health")).status_code == 200
        ready = await client.get("/ready")
        assert ready.status_code == 200
        assert ready.json() == {
            "status": "ready",
            "schema": LATEST_MIGRATION_ID,
        }
        categories = (await client.get("/v1/model-categories")).json()["items"]
        assert {item["id"] for item in categories} == {
            "text_generation",
            "other_general",
            "speech_synthesis",
            "speech_recognition",
            "music_generation",
            "video_generation",
            "image_generation",
            "end_to_end_speech",
        }
        assert next(item for item in categories if item["id"] == "image_generation") == {
            "id": "image_generation",
            "label": "图片生成",
            "type": "image",
            "sub_type": "text-to-image",
        }
        catalog = (await client.get("/v1/model-providers")).json()
        revision = catalog["revision"]
        provider_response = await client.post(
            "/v1/model-providers",
            json={
                "expected_catalog_revision": revision,
                "name": f"integration-{uuid4()}",
                "kind": "openai",
                "base_url": "https://gateway.example/v1",
                "api_key": "sk-integration-secret",
                "enabled": True,
            },
        )
        assert provider_response.status_code == 200, provider_response.text
        provider_body = provider_response.json()
        provider = provider_body["provider"]
        assert provider["has_api_key"] is True
        assert provider["api_key_hint"] == "cret"
        assert "sk-integration-secret" not in provider_response.text

        stale = await client.post(
            "/v1/model-providers",
            json={
                "expected_catalog_revision": revision,
                "name": "stale",
                "kind": "openai",
                "base_url": "",
                "api_key": "",
                "enabled": True,
            },
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "revision_conflict"

        model_response = await client.post(
            f"/v1/model-providers/{provider['id']}/models",
            json={
                "expected_catalog_revision": provider_body["revision"],
                "slug": f"model-{uuid4()}",
                "label": "集成测试模型",
                "description": "",
                "capabilities": ["chat"],
                "categories": ["text_generation", "other_general"],
                "enabled": True,
            },
        )
        assert model_response.status_code == 200, model_response.text
        model = model_response.json()["model"]
        assert model["capabilities"] == ["chat"]
        assert model["categories"] == ["text_generation", "other_general"]
        test_response = await client.post(f"/v1/model-entries/{model['id']}/test")
        assert test_response.status_code == 200, test_response.text
        log_id = test_response.json()["log_id"]
        detail = await client.get(f"/v1/llm-call-logs/{log_id}")
        assert detail.status_code == 200
        assert detail.json()["total_tokens"] == 6
        assert detail.json()["reproduction_supported"] is True
        assert "sk-integration-secret" not in detail.text

        reproduction = await client.get(f"/v1/llm-call-logs/{log_id}/reproduction-bundle")
        assert reproduction.status_code == 200
        assert reproduction.headers["content-type"] == "application/zip"
        assert "model-repro-" in reproduction.headers["content-disposition"]
        with zipfile.ZipFile(io.BytesIO(reproduction.content)) as archive:
            assert set(archive.namelist()) == {
                ".env.example",
                "README.md",
                "expected-response.json",
                "request.json",
                "run_repro.py",
            }
            request = archive.read("request.json").decode()
            readme = archive.read("README.md").decode()
            runner = archive.read("run_repro.py").decode()
            assert "sk-integration-secret" not in request
            assert "sk-integration-secret" not in readme
            assert '"endpoint": "/chat/completions"' in request
            assert "--mode sync --count 20" in readme
            assert "--mode async --count 100 --concurrency 10" in readme
            compile(runner, "run_repro.py", "exec")

        stats = await client.get("/v1/llm-call-logs/stats")
        assert stats.status_code == 200
        assert stats.json()["calls_today"] >= 1

        current = (await client.get("/v1/model-providers")).json()["revision"]
        deleted = await client.delete(
            f"/v1/model-providers/{provider['id']}",
            params={"expected_catalog_revision": current},
        )
        assert deleted.status_code == 200
        assert (await client.delete(f"/v1/llm-call-logs/{log_id}")).status_code == 200

    async with SessionLocal() as session:
        ciphertext = (
            await session.execute(
                select(ModelProvider.api_key_ciphertext).where(ModelProvider.id == provider["id"])
            )
        ).scalar_one_or_none()
        assert ciphertext is None
        await session.execute(delete(LlmCallLog).where(LlmCallLog.id == log_id))
        await session.commit()


@pytest.mark.asyncio
async def test_failed_diagnostic_is_logged(monkeypatch: pytest.MonkeyPatch) -> None:
    async def timeout(**_kwargs):
        raise httpx.ReadTimeout("upstream timeout")

    monkeypatch.setattr("app.llm.diagnostics.invoke_diagnostic", timeout)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        catalog = (await client.get("/v1/model-providers")).json()
        provider_response = await client.post(
            "/v1/model-providers",
            json={
                "expected_catalog_revision": catalog["revision"],
                "name": f"timeout-{uuid4()}",
                "kind": "anthropic",
                "base_url": "",
                "api_key": "secret",
                "enabled": True,
            },
        )
        provider_body = provider_response.json()
        provider = provider_body["provider"]
        model_response = await client.post(
            f"/v1/model-providers/{provider['id']}/models",
            json={
                "expected_catalog_revision": provider_body["revision"],
                "slug": f"timeout-model-{uuid4()}",
                "label": "",
                "description": "",
                "capabilities": ["chat"],
                "enabled": True,
            },
        )
        model = model_response.json()["model"]
        failed = await client.post(f"/v1/model-entries/{model['id']}/test")
        assert failed.status_code == 504
        log_id = failed.json()["log_id"]
        detail = (await client.get(f"/v1/llm-call-logs/{log_id}")).json()
        assert detail["status"] == "error"
        assert "timeout" in detail["error_message"]
        current = (await client.get("/v1/model-providers")).json()["revision"]
        await client.delete(
            f"/v1/model-providers/{provider['id']}",
            params={"expected_catalog_revision": current},
        )
        await client.delete(f"/v1/llm-call-logs/{log_id}")
