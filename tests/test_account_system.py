from uuid import uuid4

import httpx
import pytest

from app.accounts.service import create_account
from app.core.db import SessionLocal
from app.main import app


async def create_test_account(*, platform_admin: bool = False) -> tuple[str, str]:
    username = f"account-{uuid4().hex[:12]}"
    async with SessionLocal() as session:
        _user, _workspace, temporary = await create_account(
            session,
            username=username,
            display_name="账号测试",
            is_platform_admin=platform_admin,
        )
    return username, temporary


def unsafe_headers(client: httpx.AsyncClient) -> dict[str, str]:
    return {
        "Origin": "http://test",
        "X-CSRF-Token": client.cookies.get("fpl_csrf"),
    }


async def login_and_change_password(
    client: httpx.AsyncClient, username: str, temporary: str
) -> None:
    login = await client.post("/v1/auth/login", json={"username": username, "password": temporary})
    assert login.status_code == 200, login.text
    assert login.json()["must_change_password"] is True
    assert client.cookies.get("fpl_session")
    assert client.cookies.get("fpl_csrf")

    rejected = await client.post(
        "/v1/auth/change-password",
        json={"current_password": temporary, "new_password": "New-Password-2026!"},
    )
    assert rejected.status_code == 403
    assert rejected.json()["code"] == "csrf_failed"

    changed = await client.post(
        "/v1/auth/change-password",
        headers=unsafe_headers(client),
        json={"current_password": temporary, "new_password": "New-Password-2026!"},
    )
    assert changed.status_code == 204, changed.text
    assert (await client.get("/v1/auth/me")).json()["must_change_password"] is False


@pytest.mark.asyncio
@pytest.mark.real_auth
async def test_cookie_login_forced_password_change_csrf_and_logout() -> None:
    username, temporary = await create_test_account()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        invalid = await client.post(
            "/v1/auth/login", json={"username": username, "password": "wrong"}
        )
        assert invalid.status_code == 401
        assert invalid.json()["code"] == "invalid_credentials"

        login = await client.post(
            "/v1/auth/login", json={"username": username, "password": temporary}
        )
        assert login.status_code == 200
        blocked = await client.get("/v1/model-providers")
        assert blocked.status_code == 403
        assert blocked.json()["code"] == "password_change_required"

        changed = await client.post(
            "/v1/auth/change-password",
            headers=unsafe_headers(client),
            json={
                "current_password": temporary,
                "new_password": "New-Password-2026!",
            },
        )
        assert changed.status_code == 204
        assert (await client.get("/v1/model-providers")).status_code == 200
        logout = await client.post("/v1/auth/logout", headers=unsafe_headers(client))
        assert logout.status_code == 204
        assert (await client.get("/v1/auth/me")).status_code == 401


@pytest.mark.asyncio
@pytest.mark.real_auth
async def test_management_key_scope_and_workspace_isolation() -> None:
    first_username, first_temporary = await create_test_account()
    second_username, second_temporary = await create_test_account()
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as first,
        httpx.AsyncClient(transport=transport, base_url="http://test") as second,
    ):
        await login_and_change_password(first, first_username, first_temporary)
        await login_and_change_password(second, second_username, second_temporary)

        created = await first.post(
            "/v1/visual-workshop/projects",
            headers=unsafe_headers(first),
            json={"title": "第一空间作品", "kind": "canvas"},
        )
        assert created.status_code == 200, created.text
        project_id = created.json()["id"]
        assert (await second.get(f"/v1/visual-workshop/projects/{project_id}")).status_code == 404

        key_response = await first.post(
            "/v1/account/api-keys",
            headers=unsafe_headers(first),
            json={
                "name": "read-only",
                "scopes": ["studio:read"],
                "expires_in_days": 30,
            },
        )
        assert key_response.status_code == 201, key_response.text
        secret = key_response.json()["secret"]
        assert secret.startswith("fpm_")

    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {secret}"},
    ) as api_client:
        assert (await api_client.get("/v1/visual-workshop/projects")).status_code == 200
        assert (
            await api_client.post(
                "/v1/visual-workshop/projects",
                json={"title": "不应创建", "kind": "canvas"},
            )
        ).status_code == 403
        assert (await api_client.get("/v1/account/sessions")).status_code == 403
