from contextlib import aclosing
from uuid import uuid4

import httpx
import pytest

from app.capabilities.identity.permissions import role_permissions, role_scopes
from app.capabilities.identity.principal import StudioPrincipal
from app.capabilities.identity.route_permissions import ROUTE_PERMISSIONS
from app.console.governance.provisioning import create_account
from app.main import app
from app.runtime.db import SessionLocal

pytestmark = pytest.mark.real_auth


async def client_account(*, admin=False):
    username = f"govern-{uuid4().hex[:12]}"
    async with SessionLocal() as session:
        user, password = await create_account(
            session, username=username, display_name=username, is_platform_admin=admin
        )
        user_id, owner_user_id = user.id, user.id
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    assert (
        await client.post("/v1/auth/login", json={"username": username, "password": password})
    ).status_code == 200
    client.headers.update({"Origin": "http://test", "X-CSRF-Token": client.cookies.get("fpl_csrf")})
    assert (
        await client.post(
            "/v1/auth/change-password",
            json={"current_password": password, "new_password": "Test-Governance-Password!2026"},
        )
    ).status_code == 204
    client.headers["X-CSRF-Token"] = client.cookies.get("fpl_csrf")
    return client, username, user_id, owner_user_id


@pytest.mark.asyncio
async def test_platform_management_and_account_cas():
    admin, _, admin_id, _ = await client_account(admin=True)
    async with aclosing(admin):
        username = f"managed-{uuid4().hex[:10]}"
        created = await admin.post(
            "/v1/platform/accounts",
            json={
                "username": username,
                "display_name": "治理测试",
                "email": f"{username}@example.invalid",
            },
        )
        assert created.status_code == 201, created.text
        user = created.json()["account"]
        listed = await admin.get(
            "/v1/platform/accounts", params={"q": user["email"], "page_size": 1}
        )
        assert listed.json()["total"] == 1
        assert listed.json()["items"][0]["id"] == user["id"]
        revision = user["revision"]
        patch = await admin.patch(
            f"/v1/platform/accounts/{user['id']}",
            json={"is_platform_admin": True, "expected_revision": revision},
        )
        assert patch.status_code == 200, patch.text
        stale = await admin.patch(
            f"/v1/platform/accounts/{user['id']}",
            json={"status": "disabled", "expected_revision": revision},
        )
        assert stale.status_code == 409 and stale.json()["current"]["revision"] == revision + 1
        assert "password_hash" not in stale.text
        assert (
            await admin.post(f"/v1/platform/accounts/{user['id']}/reset-password")
        ).status_code == 422
        reset = await admin.post(
            f"/v1/platform/accounts/{user['id']}/reset-password",
            json={"expected_revision": revision + 1},
        )
        assert reset.status_code == 200 and reset.json()["temporary_password"]
        me = (await admin.get("/v1/auth/me")).json()
        own = await admin.patch(
            f"/v1/platform/accounts/{admin_id}",
            json={"is_platform_admin": False, "expected_revision": me["user"]["revision"]},
        )
        assert own.status_code == 422


def test_every_business_operation_has_an_explicit_policy():
    paths = app.openapi()["paths"]
    actual = {
        (method.upper(), path)
        for path, methods in paths.items()
        for method in methods
        if path not in {"/health", "/ready"}
        and not path.startswith(("/v1/account", "/v1/auth", "/v1/platform", "/v1/public-workspace"))
    }
    local_management = {("POST", "/v1/platform/local-models/{model_id}/actions")}
    directory = {
        ("GET", "/v1/account/directory"),
        ("GET", "/v1/account/developer-documents"),
    }
    from fpl_management.routes import router

    management = {(method, route.path) for route in router.routes for method in route.methods}
    assert actual | local_management | directory | management == set(ROUTE_PERMISSIONS)


@pytest.mark.asyncio
async def test_concurrent_account_cas_revokes_credentials_and_revalidates_admin():
    import asyncio

    first, _, _, _ = await client_account(admin=True)
    second, _, second_id, _ = await client_account(admin=True)
    target, _, target_id, _ = await client_account()
    async with aclosing(first), aclosing(second), aclosing(target):
        key = (
            await target.post(
                "/v1/account/api-keys", json={"name": "old", "scopes": ["studio:write"]}
            )
        ).json()
        current = (await target.get("/v1/auth/me")).json()["user"]
        path = f"/v1/platform/accounts/{target_id}"
        results = await asyncio.gather(
            first.patch(
                path, json={"is_platform_admin": True, "expected_revision": current["revision"]}
            ),
            second.patch(
                path, json={"status": "disabled", "expected_revision": current["revision"]}
            ),
        )
        assert sorted(r.status_code for r in results) == [200, 409]
        assert (await target.get("/v1/auth/me")).status_code == 401
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {key['secret']}"},
        ) as old_key:
            assert (await old_key.get("/v1/files")).status_code == 401
        other = (await second.get("/v1/auth/me")).json()["user"]
        assert (
            await first.patch(
                f"/v1/platform/accounts/{second_id}",
                json={"is_platform_admin": False, "expected_revision": other["revision"]},
            )
        ).status_code == 200
        assert (
            await second.post("/v1/platform/accounts", json={"username": "must-not-create"})
        ).status_code == 401


@pytest.mark.asyncio
async def test_nested_business_routers_apply_registered_permissions():
    owner, _, _, _ = await client_account()
    async with aclosing(owner):
        for path in (
            "/v1/galgame-workshop/projects",
            "/v1/thought-workshop/knowledge-bases",
            "/v1/video-editor/projects",
        ):
            result = await owner.get(path)
            assert result.status_code == 200, result.text
        created = await owner.post("/v1/galgame-workshop/projects", json={"title": "授权嵌套路由"})
        assert created.status_code == 200, created.text
        result = await owner.get(f"/v1/galgame-workshop/projects/{created.json()['id']}/story")
        assert result.status_code == 200, result.text


def test_fixed_account_capabilities_intersect_api_key_scopes():
    for role in ("admin", "user"):
        principal = StudioPrincipal(
            user_id="u",
            platform_role=role,
            must_change_password=False,
            auth_kind="management_api_key",
            scopes=frozenset({"studio:read", "studio:private_read"}),
        )
        assert principal.allows("content.read")
        assert not principal.allows("content.write")
        assert "studio:write" in role_scopes(role)
    assert not role_permissions("viewer")
