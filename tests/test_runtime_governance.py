import asyncio
from contextlib import aclosing
from uuid import uuid4

import httpx
import pytest

from app.console.governance.runtime_quotas import acquire, attach, recover_admissions, release
from app.llm.models import ModelTestGenerationTask
from app.llm.models.runtime_admission import RuntimeAdmission
from studio.contracts.identity.errors import AccountError
from studio.contracts.identity.principal import StudioPrincipal
from test_workspace_governance import client_account
from website_test_support import SessionLocal, app

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
    client, _, user_id, owner_user_id = await client_account()
    async with aclosing(client):
        principal = StudioPrincipal(
            user_id=user_id,
            must_change_password=False,
            auth_kind="session",
            scopes=frozenset({"studio:read", "studio:write"}),
            platform_role="user",
        )
        first = await acquire(principal, voice=True, sessions=SessionLocal)
        with pytest.raises(AccountError, match="runtime_quota_exceeded"):
            await acquire(principal, voice=True, sessions=SessionLocal)
        second = await acquire(principal, sessions=SessionLocal)
        with pytest.raises(AccountError, match="runtime_quota_exceeded"):
            await acquire(principal, sessions=SessionLocal)
        await release(first, sessions=SessionLocal)
        await release(second, sessions=SessionLocal)
        lease = await acquire(principal, sessions=SessionLocal)
        async with SessionLocal() as session:
            task = ModelTestGenerationTask(
                owner_user_id=owner_user_id,
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
        await release(lease, sessions=SessionLocal)
        await recover_admissions(sessions=SessionLocal)
        async with SessionLocal() as session:
            row = await session.get(RuntimeAdmission, lease)
            assert row.user_id == user_id and row.task_ids == [task_id] and row.released_at is None
            task = await session.get(ModelTestGenerationTask, task_id)
            task.status = "completed"
            await session.commit()
        first = await acquire(principal, sessions=SessionLocal)
        async with SessionLocal() as session:
            assert (await session.get(RuntimeAdmission, lease)).released_at is not None
        await release(first, sessions=SessionLocal)


@pytest.mark.asyncio
async def test_demo_services_disabled_stream_tools_install_and_policy_reading():
    admin, *_ = await client_account(admin=True)
    member, *_ = await client_account()
    async with aclosing(admin), aclosing(member):
        assert (await member.get("/v1/platform/demo-services")).status_code == 403
        assert (await member.get("/v1/account/developer-documents")).status_code == 200
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
async def test_demo_stop_drains_accepted_call_before_reinitialization():
    from app.demo_runtime.engine import DEFAULT_CONFIG, DemoRuntime

    enabled = True

    async def configuration(_service_id):
        return {**DEFAULT_CONFIG, "enabled": enabled}

    runtime = DemoRuntime(configuration)
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
