from contextlib import aclosing
from uuid import uuid4

import httpx
import pytest

from app.console.governance.provisioning import create_account
from website_test_support import SessionLocal, app

pytestmark = [pytest.mark.asyncio, pytest.mark.real_auth]


async def account_client():
    username = f"supplier-{uuid4().hex[:12]}"
    async with SessionLocal() as session:
        _, password = await create_account(
            session, username=username, display_name=username, is_platform_admin=False
        )
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    response = await client.post(
        "/v1/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text
    client.headers.update({"Origin": "http://test", "X-CSRF-Token": client.cookies["fpl_csrf"]})
    response = await client.post(
        "/v1/auth/change-password",
        json={"current_password": password, "new_password": "Supplier-Tests-2026!Pass"},
    )
    assert response.status_code == 204, response.text
    client.headers["X-CSRF-Token"] = client.cookies["fpl_csrf"]
    return client


async def revision(client):
    response = await client.get("/v1/model-providers")
    assert response.status_code == 200, response.text
    return response.json()["revision"]


async def add_supplier(client, name="SenseAudio"):
    response = await client.post(
        "/v1/model-suppliers",
        json={"name": name, "expected_catalog_revision": await revision(client)},
    )
    assert response.status_code == 200, response.text
    return response.json()["supplier"]


async def test_supplier_lifecycle_preserves_connections_and_catalog_cas():
    client = await account_client()
    async with aclosing(client):
        old = await revision(client)
        supplier = await add_supplier(client, " SenseAudio ")
        assert supplier["name"] == "SenseAudio"
        assert supplier["managed_fields"] == []
        stale = await client.patch(
            f"/v1/model-suppliers/{supplier['id']}",
            json={"name": "stale", "expected_catalog_revision": old},
        )
        assert stale.status_code == 409
        assert stale.json()["current"]["suppliers"][0]["id"] == supplier["id"]
        assert (
            await client.post("/v1/model-suppliers", json={"name": "missing revision"})
        ).status_code == 422
        assert (
            await client.post(
                "/v1/model-suppliers",
                json={"name": "   ", "expected_catalog_revision": await revision(client)},
            )
        ).status_code == 422

        body = {"name": "通用连接", "kind": "openai", "base_url": "", "enabled": True}
        response = await client.post(
            "/v1/model-providers",
            json={
                **body,
                "supplier_id": supplier["id"],
                "api_key": "supplier-test-secret",
                "expected_catalog_revision": await revision(client),
            },
        )
        assert response.status_code == 200, response.text
        provider = response.json()["provider"]
        assert provider["supplier_id"] == supplier["id"]
        response = await client.post(
            f"/v1/model-providers/{provider['id']}/models",
            json={
                "slug": "test-model",
                "capabilities": ["chat"],
                "categories": ["text_generation"],
                "expected_catalog_revision": await revision(client),
            },
        )
        assert response.status_code == 200, response.text
        model_id = response.json()["model"]["id"]
        before = await revision(client)
        response = await client.delete(
            f"/v1/model-suppliers/{supplier['id']}", params={"expected_catalog_revision": before}
        )
        assert response.status_code == 409
        assert await revision(client) == before

        # Existing clients omit supplier_id when changing connection configuration.
        response = await client.patch(
            f"/v1/model-providers/{provider['id']}",
            json={**body, "name": "已重命名", "expected_catalog_revision": await revision(client)},
        )
        assert response.status_code == 200, response.text
        assert response.json()["provider"]["supplier_id"] == supplier["id"]
        response = await client.post(
            f"/v1/model-providers/{provider['id']}/enabled",
            json={"enabled": False, "expected_catalog_revision": await revision(client)},
        )
        assert response.status_code == 200, response.text
        assert response.json()["provider"]["supplier_id"] == supplier["id"]
        assert response.json()["provider"]["has_api_key"]
        response = await client.patch(
            f"/v1/model-providers/{provider['id']}",
            json={**body, "supplier_id": None, "expected_catalog_revision": await revision(client)},
        )
        assert response.status_code == 200, response.text
        assert response.json()["provider"]["supplier_id"] is None
        assert response.json()["provider"]["models"][0]["id"] == model_id
        assert response.json()["provider"]["api_key_hint"] == "cret"
        response = await client.delete(
            f"/v1/model-suppliers/{supplier['id']}",
            params={"expected_catalog_revision": await revision(client)},
        )
        assert response.status_code == 200, response.text


async def test_supplier_cross_workspace_access_is_not_found():
    first, second = await account_client(), await account_client()
    async with aclosing(first), aclosing(second):
        supplier = await add_supplier(first)
        assert supplier["id"] not in str(
            (await second.get("/v1/model-providers")).json()["suppliers"]
        )
        current = await revision(second)
        response = await second.patch(
            f"/v1/model-suppliers/{supplier['id']}",
            json={"name": "other", "expected_catalog_revision": current},
        )
        assert response.status_code == 404
        response = await second.post(
            "/v1/model-providers",
            json={
                "name": "foreign group",
                "kind": "openai",
                "supplier_id": supplier["id"],
                "expected_catalog_revision": current,
            },
        )
        assert response.status_code == 404
        assert await revision(second) == current


async def test_template_supplier_name_and_deletion_are_locked_in_workspace():
    from test_workspace_governance import client_account

    admin, _, _, _ = await client_account(admin=True)
    key = f"managed-supplier-{uuid4().hex}"
    async with aclosing(admin):
        template = (await admin.get("/v1/platform/model-service-templates/user")).json()
        response = await admin.put(
            "/v1/platform/model-service-templates/user",
            json={
                "expected_revision": template["revision"],
                "value": {"suppliers": [{"template_key": key, "name": "平台分组"}]},
            },
        )
        assert response.status_code == 200, response.text
        member = await account_client()
        async with aclosing(member):
            catalog = (await member.get("/v1/model-providers")).json()
            supplier = next(row for row in catalog["suppliers"] if row["template_key"] == key)
            assert supplier["origin"] == "role_template"
            assert supplier["managed_fields"] == ["name"]
            response = await member.patch(
                f"/v1/model-suppliers/{supplier['id']}",
                json={"name": "changed", "expected_catalog_revision": catalog["revision"]},
            )
            assert response.status_code == 403, response.text
            response = await member.delete(
                f"/v1/model-suppliers/{supplier['id']}",
                params={"expected_catalog_revision": catalog["revision"]},
            )
            assert response.status_code == 403, response.text
            assert await revision(member) == catalog["revision"]


async def test_template_sync_preserves_supplier_connection_model_ids_and_custom_configuration():
    from app.console.governance.model_template_sync import ModelTemplateSyncRunner
    from test_workspace_governance import client_account

    admin, _, _, _ = await client_account(admin=True)
    key = uuid4().hex
    payload = {
        "suppliers": [{"template_key": key, "name": "原平台分组"}],
        "providers": [
            {
                "template_key": key + "-p",
                "supplier_key": key,
                "name": "平台连接",
                "kind": "openai",
                "api_key": "template-fixture-key",
                "models": [{"template_key": key + "-m", "slug": "template-model"}],
            }
        ],
    }
    async with aclosing(admin):
        template = (await admin.get("/v1/platform/model-service-templates/user")).json()
        response = await admin.put(
            "/v1/platform/model-service-templates/user",
            json={"expected_revision": template["revision"], "value": payload},
        )
        assert response.status_code == 200, response.text
        saved = response.json()
        member = await account_client()
        async with aclosing(member):
            before = (await member.get("/v1/model-providers")).json()
            supplier = next(s for s in before["suppliers"] if s["template_key"] == key)
            provider = next(p for p in before["providers"] if p["template_key"] == key + "-p")
            custom = await add_supplier(member, "自建分组")
            response = await member.post(
                "/v1/model-providers",
                json={
                    "name": "自建连接",
                    "kind": "openai",
                    "supplier_id": custom["id"],
                    "api_key": "custom-fixture-key",
                    "expected_catalog_revision": await revision(member),
                },
            )
            assert response.status_code == 200, response.text
            custom_provider = response.json()["provider"]
            payload["suppliers"][0]["name"] = "新平台分组"
            payload["providers"][0]["models"][0]["label"] = "新模型名称"
            response = await admin.put(
                "/v1/platform/model-service-templates/user",
                json={"expected_revision": saved["revision"], "value": payload},
            )
            assert response.status_code == 200, response.text
            current = (await member.get("/v1/model-providers")).json()
            assert (
                next(s for s in current["suppliers"] if s["id"] == supplier["id"])["name"]
                == "原平台分组"
            )
            preview = await admin.post(
                "/v1/platform/model-service-templates/user/preview",
                json={"expected_template_revision": response.json()["revision"]},
            )
            assert preview.status_code == 201, preview.text
            job = preview.json()
            started = await admin.post(
                f"/v1/platform/model-service-templates/sync-jobs/{job['id']}/start",
                json={"expected_revision": job["revision"]},
            )
            assert started.status_code == 200, started.text
            runner = ModelTemplateSyncRunner(sessions=SessionLocal)
            for _ in range(len(job["items"]) + 1):
                await runner.process_once()
            after = (await member.get("/v1/model-providers")).json()
            synced_supplier = next(s for s in after["suppliers"] if s["template_key"] == key)
            synced_provider = next(p for p in after["providers"] if p["template_key"] == key + "-p")
            assert synced_supplier["id"] == supplier["id"]
            assert synced_supplier["name"] == "新平台分组"
            assert synced_provider["id"] == provider["id"]
            assert synced_provider["supplier_id"] == supplier["id"]
            assert synced_provider["models"][0]["id"] == provider["models"][0]["id"]
            assert synced_provider["models"][0]["label"] == "新模型名称"
            assert synced_provider["api_key_hint"] == provider["api_key_hint"]
            assert (
                next(p for p in after["providers"] if p["id"] == custom_provider["id"])
                == custom_provider
            )
