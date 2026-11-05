from datetime import datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select

from app.capabilities.identity.passwords import normalize_username
from app.capabilities.identity.security import hash_secret
from app.console.governance.provisioning import create_account
from app.console.models import (
    AuthSession,
    ManagementApiKey,
    SecurityAuditEvent,
    User,
)
from studio.apps.model_service.storage.models.model_service import ModelProvider
from studio.runtime.time import utc_now
from website_test_support import SessionLocal, app


async def create_test_account(*, platform_admin: bool = False) -> tuple[str, str]:
    username = f"account-{uuid4().hex[:12]}"
    async with SessionLocal() as session:
        _user, temporary = await create_account(
            session,
            username=username,
            display_name="账号测试",
            is_platform_admin=platform_admin,
        )
    return username, temporary


@pytest.mark.asyncio
async def test_account_provisioning_rolls_back_when_catalog_seed_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    username = f"rollback-{uuid4().hex[:12]}"
    async with SessionLocal() as session:
        before = {
            "users": await session.scalar(select(func.count(User.id))),
            "audits": await session.scalar(select(func.count(SecurityAuditEvent.id))),
            "providers": await session.scalar(select(func.count(ModelProvider.id))),
        }

    async def fail_seed(_session, _workspace_id: str) -> bool:
        raise RuntimeError("seed failed")

    monkeypatch.setattr(
        "app.console.governance.provisioning.ensure_account_model_catalog", fail_seed
    )
    async with SessionLocal() as session:
        with pytest.raises(RuntimeError, match="seed failed"):
            await create_account(
                session,
                username=username,
                display_name="事务回滚",
                is_platform_admin=False,
            )

    async with SessionLocal() as session:
        assert (
            await session.scalar(
                select(User.id).where(User.username_normalized == normalize_username(username))
            )
            is None
        )
        after = {
            "users": await session.scalar(select(func.count(User.id))),
            "audits": await session.scalar(select(func.count(SecurityAuditEvent.id))),
            "providers": await session.scalar(select(func.count(ModelProvider.id))),
        }
    assert after == before


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
async def test_management_key_scope_and_account_isolation() -> None:
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


@pytest.mark.asyncio
@pytest.mark.real_auth
async def test_management_key_creation_does_not_require_password_reauthentication() -> None:
    username, temporary = await create_test_account()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        await login_and_change_password(client, username, temporary)
        raw_session = client.cookies.get("fpl_session")
        assert raw_session

        async with SessionLocal() as session:
            auth_session = await session.scalar(
                select(AuthSession).where(AuthSession.token_hash == hash_secret(raw_session))
            )
            assert auth_session is not None
            auth_session.reauthenticated_at = utc_now() - timedelta(days=1)
            await session.commit()

        created = await client.post(
            "/v1/account/api-keys",
            headers=unsafe_headers(client),
            json={
                "name": "no-secondary-password-check",
                "scopes": ["studio:read", "studio:write"],
                "expires_in_days": 1,
            },
        )
        assert created.status_code == 201, created.text
        assert created.json()["secret"].startswith("fpm_")


@pytest.mark.asyncio
@pytest.mark.real_auth
async def test_management_key_renew_delete_conflicts_and_isolation() -> None:
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
            "/v1/account/api-keys",
            headers=unsafe_headers(first),
            json={"name": "renewable", "scopes": ["studio:read"], "expires_in_days": 30},
        )
        assert created.status_code == 201, created.text
        key = created.json()["api_key"]
        secret = created.json()["secret"]

        for invalid_days in (0, 366):
            invalid_duration = await first.post(
                f"/v1/account/api-keys/{key['id']}/renew",
                headers=unsafe_headers(first),
                json={
                    "expected_revision": key["revision"],
                    "expires_in_days": invalid_days,
                },
            )
            assert invalid_duration.status_code == 422

        assert (
            await first.post(
                f"/v1/account/api-keys/{key['id']}/renew",
                json={"expected_revision": key["revision"], "expires_in_days": 30},
            )
        ).status_code == 403
        for client in (second,):
            renewed_elsewhere = await client.post(
                f"/v1/account/api-keys/{key['id']}/renew",
                headers=unsafe_headers(client),
                json={"expected_revision": key["revision"], "expires_in_days": 30},
            )
            assert renewed_elsewhere.status_code == 404
            deleted_elsewhere = await client.request(
                "DELETE",
                f"/v1/account/api-keys/{key['id']}",
                headers=unsafe_headers(client),
                json={"expected_revision": key["revision"]},
            )
            assert deleted_elsewhere.status_code == 404

        renewed = await first.post(
            f"/v1/account/api-keys/{key['id']}/renew",
            headers=unsafe_headers(first),
            json={"expected_revision": key["revision"], "expires_in_days": 30},
        )
        assert renewed.status_code == 200, renewed.text
        renewed_key = renewed.json()
        assert renewed_key["revision"] == key["revision"] + 1
        assert datetime.fromisoformat(renewed_key["expires_at"]) == datetime.fromisoformat(
            key["expires_at"]
        ) + timedelta(days=30)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {secret}"},
        ) as renewed_client:
            assert (await renewed_client.get("/v1/visual-workshop/projects")).status_code == 200

        stale_renewal = await first.post(
            f"/v1/account/api-keys/{key['id']}/renew",
            headers=unsafe_headers(first),
            json={"expected_revision": key["revision"], "expires_in_days": 30},
        )
        assert stale_renewal.status_code == 409
        stale_revoke = await first.post(
            f"/v1/account/api-keys/{key['id']}/revoke",
            headers=unsafe_headers(first),
            json={"expected_revision": key["revision"]},
        )
        assert stale_revoke.status_code == 409
        conflict = await first.request(
            "DELETE",
            f"/v1/account/api-keys/{key['id']}",
            headers=unsafe_headers(first),
            json={"expected_revision": key["revision"]},
        )
        assert conflict.status_code == 409
        assert conflict.json()["current"]["revision"] == renewed_key["revision"]
        assert "secret" not in conflict.text
        assert "key_hash" not in conflict.text

        revoked = await first.post(
            f"/v1/account/api-keys/{key['id']}/revoke",
            headers=unsafe_headers(first),
            json={"expected_revision": renewed_key["revision"]},
        )
        assert revoked.status_code == 200, revoked.text
        revoked_key = revoked.json()
        rejected = await first.post(
            f"/v1/account/api-keys/{key['id']}/renew",
            headers=unsafe_headers(first),
            json={"expected_revision": revoked_key["revision"], "expires_in_days": 90},
        )
        assert rejected.status_code == 422
        assert rejected.json()["code"] == "api_key_revoked"

        deleted = await first.request(
            "DELETE",
            f"/v1/account/api-keys/{key['id']}",
            headers=unsafe_headers(first),
            json={"expected_revision": revoked_key["revision"]},
        )
        assert deleted.status_code == 204, deleted.text

        expired_created = await first.post(
            "/v1/account/api-keys",
            headers=unsafe_headers(first),
            json={"name": "expired", "scopes": ["studio:read"], "expires_in_days": 1},
        )
        expired_key = expired_created.json()["api_key"]
        async with SessionLocal() as session:
            row = await session.get(ManagementApiKey, expired_key["id"])
            assert row is not None
            row.expires_at = utc_now() - timedelta(days=1)
            await session.commit()

        renewed_expired = await first.post(
            f"/v1/account/api-keys/{expired_key['id']}/renew",
            headers=unsafe_headers(first),
            json={"expected_revision": expired_key["revision"], "expires_in_days": 30},
        )
        assert renewed_expired.status_code == 200, renewed_expired.text
        renewed_expiry = datetime.fromisoformat(renewed_expired.json()["expires_at"])
        assert utc_now() + timedelta(days=29) < renewed_expiry < utc_now() + timedelta(days=31)
        assert (
            await first.request(
                "DELETE",
                f"/v1/account/api-keys/{expired_key['id']}",
                headers=unsafe_headers(first),
                json={"expected_revision": renewed_expired.json()["revision"]},
            )
        ).status_code == 204

        expired_delete = await first.post(
            "/v1/account/api-keys",
            headers=unsafe_headers(first),
            json={"name": "expired-delete", "scopes": ["studio:read"], "expires_in_days": 1},
        )
        expired_delete_key = expired_delete.json()["api_key"]
        async with SessionLocal() as session:
            row = await session.get(ManagementApiKey, expired_delete_key["id"])
            assert row is not None
            row.expires_at = utc_now() - timedelta(days=1)
            await session.commit()
        assert (
            await first.request(
                "DELETE",
                f"/v1/account/api-keys/{expired_delete_key['id']}",
                headers=unsafe_headers(first),
                json={"expected_revision": expired_delete_key["revision"]},
            )
        ).status_code == 204

        assert (await first.get("/v1/account/api-keys")).json() == []
        events = (await first.get("/v1/account/security-events")).json()["items"]
        event_types = {event["event_type"] for event in events}
        assert "management_api_key.renewed" in event_types
        assert "management_api_key.deleted" in event_types
        assert all("secret" not in str(event["metadata"]) for event in events)

    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {secret}"},
    ) as keyed:
        assert (await keyed.get("/v1/visual-workshop/projects")).status_code == 401


@pytest.mark.asyncio
async def test_login_keeps_storage_maintenance_visible_until_required_restart(monkeypatch):
    username, password = await create_test_account()
    monkeypatch.setattr(app.state, "storage_upgrade_required", True, raising=False)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/v1/auth/login", json={"username": username, "password": password}
        )
    assert response.status_code == 200
    assert response.json()["storage_upgrade_required"] is True
