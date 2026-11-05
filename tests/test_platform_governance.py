from contextlib import aclosing
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select

from app.console.governance.model_template_sync import ModelTemplateSyncRunner
from app.console.models import User
from app.llm.models import ModelProvider
from test_workspace_governance import client_account
from website_test_support import SessionLocal, app

pytestmark = pytest.mark.real_auth


@pytest.mark.asyncio
async def test_registration_code_redemption_and_secret_boundaries():
    admin, _, _, _ = await client_account(admin=True)
    async with aclosing(admin):
        created = await admin.post(
            "/v1/platform/registration-invite-codes", json={"name": "新成员", "max_uses": 1}
        )
        assert created.status_code == 201, created.text
        code = created.json()["secret"]
        row = created.json()["invite"]
        assert code not in (await admin.get("/v1/platform/registration-invite-codes")).text
        user = f"reg-{uuid4().hex[:12]}"
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as guest:
            registered = await guest.post(
                "/v1/auth/register",
                json={
                    "username": user,
                    "password": "Registration-Password!2026",
                    "invite_code": code,
                },
            )
            assert registered.status_code == 201, registered.text
            assert registered.json()["user"]["platform_role"] == "user"
            assert not registered.json()["must_change_password"]
            assert "diagnostics.model" in registered.json()["permission_keys"]
            denied = await guest.post(
                "/v1/auth/register",
                json={
                    "username": f"reg-{uuid4().hex[:12]}",
                    "password": "Registration-Password!2026",
                    "invite_code": code,
                },
            )
            assert denied.status_code == 422, denied.text
        history = await admin.get(f"/v1/platform/registration-invite-codes/{row['id']}/redemptions")
        assert history.json()["total"] == 1 and history.json()["items"][0]["username"] == user
        stale = await admin.patch(
            f"/v1/platform/registration-invite-codes/{row['id']}",
            json={"enabled": False, "expected_revision": row["revision"]},
        )
        assert stale.status_code == 409, stale.text
        assert code not in stale.text and "ciphertext" not in stale.text
        async with SessionLocal() as session:
            assert await session.scalar(select(User.id).where(User.username == user))


@pytest.mark.asyncio
async def test_template_preview_secret_preservation_and_initialization():
    admin, _, _, _ = await client_account(admin=True)
    async with aclosing(admin):
        state = (await admin.get("/v1/platform/model-service-templates/user")).json()
        name = f"template-{uuid4().hex[:8]}"
        value = {
            "providers": [
                {
                    "template_key": name,
                    "name": name,
                    "kind": "openai",
                    "base_url": "https://example.invalid/v1",
                    "api_key": "template-secret-never-output",
                    "models": [
                        {"template_key": name + "-model", "slug": name, "capabilities": ["chat"]}
                    ],
                }
            ],
            "defaults": {"chat": name + "-model"},
        }
        saved = await admin.put(
            "/v1/platform/model-service-templates/user",
            json={"value": value, "expected_revision": state["revision"]},
        )
        assert saved.status_code == 200, saved.text
        assert "template-secret-never-output" not in saved.text and "ciphertext" not in saved.text
        assert saved.json()["value"]["providers"][0]["has_api_key"]
        created = await admin.post(
            "/v1/platform/accounts", json={"username": f"tmpl-{uuid4().hex[:10]}"}
        )
        assert created.status_code == 201, created.text
        preview = await admin.post(
            "/v1/platform/model-service-templates/user/preview",
            json={"expected_template_revision": saved.json()["revision"]},
        )
        assert preview.status_code == 201, preview.text
        job = preview.json()
        assert job["status"] == "preview"
        assert "ciphertext" not in preview.text
        started = await admin.post(
            f"/v1/platform/model-service-templates/sync-jobs/{job['id']}/start",
            json={"expected_revision": job["revision"]},
        )
        assert started.status_code == 200, started.text
        worker = ModelTemplateSyncRunner(sessions=SessionLocal)
        for _ in range(len(job["items"]) + 1):
            await worker.process_once()
        finished = (
            await admin.get(f"/v1/platform/model-service-templates/sync-jobs/{job['id']}")
        ).json()
        assert finished["status"] == "completed", finished
        assert any(item["status"] == "succeeded" for item in finished["items"]), finished
        async with SessionLocal() as session:
            assert await session.scalar(
                select(ModelProvider.id).where(ModelProvider.template_key == name)
            )
