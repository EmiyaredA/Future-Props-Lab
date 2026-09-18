import asyncio
from contextlib import aclosing
from uuid import uuid4

import httpx
import pytest

from app.capabilities.identity.errors import AccountError
from app.capabilities.identity.principal import StudioPrincipal
from app.console.governance.runtime_quotas import acquire, attach, recover_admissions, release
from app.main import app
from app.models import ModelTestGenerationTask
from app.models.runtime_admission import RuntimeAdmission
from app.runtime.db import SessionLocal
from test_workspace_governance import client_account

pytestmark = pytest.mark.real_auth


@pytest.mark.asyncio
async def test_atomic_registration_capacity_competition():
    admin, *_ = await client_account(admin=True)
    async with aclosing(admin):
        result = await admin.post(
            "/v1/platform/registration-invite-codes", json={"name": "名额竞争", "max_uses": 1}
        )
        code = result.json()["secret"]

        async def register():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as guest:
                return await guest.post(
                    "/v1/auth/register",
                    json={
                        "username": "race-" + uuid4().hex[:12],
                        "password": "Registration!2026-Strong",
                        "invite_code": code,
                    },
                )

        results = await asyncio.gather(register(), register())
        assert sorted(response.status_code for response in results) == [201, 422]


@pytest.mark.asyncio
async def test_quota_voice_release_and_persistent_task_ownership():
    client, _, user_id, workspace_id = await client_account()
    async with aclosing(client):
        principal = StudioPrincipal(
            user_id=user_id,
            workspace_id=workspace_id,
            workspace_access="owner",
            member_role="owner",
            is_platform_admin=False,
            must_change_password=False,
            auth_kind="session",
            scopes=frozenset({"studio:read", "studio:write"}),
            platform_role="member",
        )
        first = await acquire(principal, voice=True)
        with pytest.raises(AccountError, match="runtime_quota_exceeded"):
            await acquire(principal, voice=True)
        second = await acquire(principal)
        with pytest.raises(AccountError, match="runtime_quota_exceeded"):
            await acquire(principal)
        await release(first)
        await release(second)
        lease = await acquire(principal)
        async with SessionLocal() as session:
            task = ModelTestGenerationTask(
                workspace_id=workspace_id,
                provider_kind="senseaudio_image",
                generation_kind="image",
                provider_name="deterministic",
                model_slug="mock",
                request_payload={},
                status="queued",
            )
            session.add(task)
            await session.flush()
            await attach(session, lease, "model", [task.id])
            await session.commit()
            task_id = task.id
        await release(lease)
        await recover_admissions()
        async with SessionLocal() as session:
            row = await session.get(RuntimeAdmission, lease)
            assert row.user_id == user_id and row.task_ids == [task_id] and row.released_at is None
            task = await session.get(ModelTestGenerationTask, task_id)
            task.status = "completed"
            await session.commit()
        first = await acquire(principal)
        async with SessionLocal() as session:
            assert (await session.get(RuntimeAdmission, lease)).released_at is not None
        await release(first)


@pytest.mark.asyncio
async def test_demo_services_disabled_stream_tools_install_and_policy_reading():
    admin, *_ = await client_account(admin=True)
    member, *_ = await client_account()
    async with aclosing(admin), aclosing(member):
        assert (await member.get("/v1/platform/demo-services")).status_code == 403
        assert (await member.get("/v1/account/developer-documents")).status_code == 403
        assert (await admin.get("/v1/account/developer-documents")).status_code == 200
        services = (await admin.get("/v1/platform/demo-services")).json()
        mock = next(item for item in services if item["id"] == "mock_model")
        configured = await admin.put(
            "/v1/platform/demo-services/mock_model",
            json={
                "expected_revision": mock["revision"],
                "value": {"enabled": True, "response_text": "确定性测试"},
            },
        )
        assert configured.status_code == 200, configured.text
        try:
            stream = await member.post(
                "/v1/demo-services/model/chat/completions",
                json={"stream": True, "messages": [{"role": "user", "content": "hello"}]},
            )
            assert stream.status_code == 200, stream.text
            assert "[DONE]" in stream.text and "确定性测试" in stream.text
            tools = await member.post(
                "/v1/demo-services/model/chat/completions",
                json={
                    "tools": [
                        {
                            "type": "function",
                            "function": {"name": "orders", "parameters": {"type": "object"}},
                        }
                    ]
                },
            )
            assert (
                tools.json()["choices"][0]["message"]["tool_calls"][0]["function"]["name"]
                == "orders"
            )
            catalog = (await admin.get("/v1/model-providers")).json()
            installed = await admin.post(
                "/v1/account/demo-services/mock_model/install",
                json={"expected_catalog_revision": catalog["revision"]},
            )
            assert installed.status_code == 200, installed.text
            after = (await admin.get("/v1/model-providers")).json()
            provider = next(
                item for item in after["providers"] if item["id"] == installed.json()["id"]
            )
            updated = await admin.put(
                "/v1/model-catalog/defaults",
                json={
                    "expected_revision": after["revision"],
                    "default_model_ids": {"chat": provider["models"][0]["id"]},
                },
            )
            assert updated.status_code == 200, updated.text
            assert updated.json()["default_model_ids"]["chat"] == provider["models"][0]["id"]
            stale = await admin.put(
                "/v1/model-catalog/defaults",
                json={"expected_revision": after["revision"], "default_model_ids": {}},
            )
            assert stale.status_code == 409
        finally:
            current = (await admin.get("/v1/platform/demo-services")).json()
            current = next(item for item in current if item["id"] == "mock_model")
            await admin.put(
                "/v1/platform/demo-services/mock_model",
                json={"expected_revision": current["revision"], "value": mock["value"]},
            )


@pytest.mark.asyncio
async def test_sensitive_diagnostics_and_official_mark_require_current_policy():
    from app.models import LlmCallLog

    admin, *_ = await client_account(admin=True)
    member, _, _, workspace_id = await client_account()
    async with aclosing(admin), aclosing(member):
        async with SessionLocal() as session:
            log = LlmCallLog(
                workspace_id=workspace_id,
                call_source="model_playground",
                provider_kind="openai",
                model="deterministic",
                trace_id="governance",
                request_payload={"secret_input": "hidden-input"},
                response_payload={"raw": "hidden-response"},
                latency_ms=1,
                status="success",
            )
            session.add(log)
            await session.commit()
            log_id = log.id
        response = await member.get(f"/v1/llm-call-logs/{log_id}")
        assert response.status_code == 200, response.text
        assert "hidden-input" not in response.text and "hidden-response" not in response.text
        assert not response.json()["reproduction_supported"]
        assert (
            await member.get(f"/v1/llm-call-logs/{log_id}/reproduction-bundle")
        ).status_code == 403
        assert (await member.get("/v1/account/log-workspaces")).status_code == 403
        state = (await admin.get("/v1/platform/permission-policy")).json()
        original = state["value"]
        changed = {**original, "member": {**original["member"], "view_model_diagnostics": True}}
        updated = await admin.patch(
            "/v1/platform/permission-policy",
            json={"expected_revision": state["revision"], "value": changed},
        )
        assert updated.status_code == 200, updated.text
        try:
            refreshed = await member.get(f"/v1/llm-call-logs/{log_id}")
            assert refreshed.json()["request_payload"]["secret_input"] == "hidden-input"
        finally:
            await admin.patch(
                "/v1/platform/permission-policy",
                json={"expected_revision": updated.json()["revision"], "value": original},
            )
        revoked = await member.get(f"/v1/llm-call-logs/{log_id}")
        assert "hidden-input" not in revoked.text
        project = await member.post(
            "/v1/visual-workshop/projects", json={"title": "官方标记权限", "kind": "image"}
        )
        assert project.status_code in (200, 201), project.text
        record = project.json()
        denied = await member.patch(
            f"/v1/account/project-certification/visual/{record['id']}",
            json={"is_official": True, "expected_revision": record["revision"]},
        )
        assert denied.status_code == 403, denied.text
        await admin.post("/v1/account/workspaces/switch", json={"workspace_id": workspace_id})
        granted = await admin.patch(
            f"/v1/account/project-certification/visual/{record['id']}",
            json={"is_official": True, "expected_revision": record["revision"]},
        )
        assert granted.status_code == 200, granted.text
        assert (await member.get(f"/v1/visual-workshop/projects/{record['id']}")).json()[
            "is_official"
        ]


@pytest.mark.asyncio
async def test_demo_stop_drains_accepted_call_before_reinitialization(monkeypatch):
    from app.demo_runtime import runtime

    enabled = True

    async def configuration(_service_id):
        return {**runtime.DEFAULT_CONFIG, "enabled": enabled}

    monkeypatch.setattr(runtime, "configuration", configuration)
    monkeypatch.setattr(runtime, "_condition", asyncio.Condition())
    entered, finish = asyncio.Event(), asyncio.Event()

    async def accepted_call():
        async with runtime.invocation("mock_model"):
            entered.set()
            await finish.wait()

    accepted = asyncio.create_task(accepted_call())
    await entered.wait()
    enabled = False
    with pytest.raises(RuntimeError):
        async with runtime.invocation("mock_model"):
            pass
    restarting = asyncio.create_task(runtime.reinitialize("mock_model"))
    await asyncio.sleep(0)
    assert not restarting.done()
    finish.set()
    await accepted
    await restarting
    assert (await runtime.status("mock_model"))["active_calls"] == 0
