"""Call log credential snapshots and api_key_id filters."""

from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from studio.apps.model_service.storage.models.call_log import LlmCallLog
from website_test_support import SessionLocal, app


@pytest.mark.asyncio
async def test_call_log_credential_filter_and_model_inference_source():
    session_id, key_id, inference_id = (str(uuid4()) for _ in range(3))
    key_uuid = str(uuid4())
    async with SessionLocal() as session:
        session.add_all(
            [
                LlmCallLog(
                    owner_user_id="test-user",
                    id=session_id,
                    call_source="model_playground",
                    provider_kind="openai",
                    model="cred-session-model",
                    auth_kind="session",
                    trace_id=str(uuid4()),
                    status="success",
                    latency_ms=10,
                ),
                LlmCallLog(
                    owner_user_id="test-user",
                    id=key_id,
                    call_source="model_playground",
                    provider_kind="openai",
                    model="cred-key-model",
                    auth_kind="management_api_key",
                    api_key_id=key_uuid,
                    api_key_name="自动化脚本",
                    api_key_prefix="fpm_n_test",
                    trace_id=str(uuid4()),
                    status="success",
                    latency_ms=20,
                ),
                LlmCallLog(
                    owner_user_id="test-user",
                    id=inference_id,
                    call_source="model_inference",
                    provider_kind="openai",
                    model="cred-inference-model",
                    auth_kind="management_api_key",
                    api_key_id=key_uuid,
                    api_key_name="自动化脚本",
                    api_key_prefix="fpm_n_test",
                    trace_id=str(uuid4()),
                    status="success",
                    latency_ms=30,
                ),
            ]
        )
        await session.commit()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            session_logs = await client.get("/v1/llm-call-logs", params={"api_key_id": "session"})
            assert session_logs.status_code == 200, session_logs.text
            assert session_id in {item["id"] for item in session_logs.json()["items"]}
            assert key_id not in {item["id"] for item in session_logs.json()["items"]}

            key_logs = await client.get("/v1/llm-call-logs", params={"api_key_id": key_uuid})
            assert key_logs.status_code == 200, key_logs.text
            ids = {item["id"] for item in key_logs.json()["items"]}
            assert key_id in ids and inference_id in ids and session_id not in ids
            keyed = next(item for item in key_logs.json()["items"] if item["id"] == key_id)
            assert keyed["api_key_name"] == "自动化脚本"
            assert keyed["api_key_prefix"] == "fpm_n_test"

            inference = await client.get(
                "/v1/llm-call-logs", params={"call_source": "model_inference"}
            )
            assert inference.status_code == 200, inference.text
            assert inference_id in {item["id"] for item in inference.json()["items"]}

            detail = await client.get(f"/v1/llm-call-logs/{key_id}")
            assert detail.status_code == 200, detail.text
            assert detail.json()["auth_kind"] == "management_api_key"
            assert detail.json()["api_key_id"] == key_uuid
    finally:
        async with SessionLocal() as session:
            await session.execute(
                delete(LlmCallLog).where(LlmCallLog.id.in_([session_id, key_id, inference_id]))
            )
            await session.commit()
