from contextlib import aclosing
from unittest.mock import AsyncMock
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
        user, workspace, password = await create_account(
            session, username=username, display_name=username, is_platform_admin=admin
        )
        user_id, workspace_id = user.id, workspace.id
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
    return client, username, user_id, workspace_id


@pytest.mark.asyncio
async def test_platform_management_cas_and_workspace_creation():
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
        workspace = await admin.post(
            "/v1/platform/workspaces", json={"name": "团队空间", "owner_user_id": user["id"]}
        )
        assert workspace.status_code == 201, workspace.text
        assert workspace.json()["visibility"] == "private"
        assert (await admin.get("/v1/platform/workspaces", params={"q": "团队空间"})).json()[
            "items"
        ][0]["member_count"] == 1
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


@pytest.mark.asyncio
async def test_member_roles_invitation_isolation_and_key_downgrade():
    owner, _, _, workspace_id = await client_account()
    viewer, viewer_name, viewer_id, _ = await client_account()
    member, member_name, _, _ = await client_account()
    async with aclosing(owner), aclosing(viewer), aclosing(member):
        assert (await viewer.get("/v1/platform/accounts")).status_code == 403
        invitation = await owner.post(
            "/v1/account/workspaces/current/invitations",
            json={"username": viewer_name, "role": "viewer"},
        )
        assert invitation.status_code == 201, invitation.text
        inv = invitation.json()
        accepted = await viewer.post(
            f"/v1/account/workspace-invitations/{inv['id']}/accept",
            json={"expected_revision": inv["revision"]},
        )
        assert accepted.status_code == 204, accepted.text
        assert (
            await viewer.post("/v1/account/workspaces/switch", json={"workspace_id": workspace_id})
        ).status_code == 200
        me = (await viewer.get("/v1/auth/me")).json()
        assert me["workspace"]["role"] == "viewer"
        assert me["workspace"]["permission_keys"] == ["content.read"]
        assert (await viewer.get("/v1/files")).status_code == 200
        assert (
            await viewer.post(
                "/v1/visual-workshop/projects", json={"title": "禁止", "kind": "canvas"}
            )
        ).status_code == 403
        assert (await viewer.get("/v1/llm-call-logs")).status_code == 403
        assert (await viewer.get("/v1/account/workspaces/current/invitations")).status_code == 403
        assert (await viewer.get("/v1/account/workspaces/current/audit-events")).status_code == 403
        key = await viewer.post(
            "/v1/account/api-keys", json={"name": "readonly", "scopes": ["studio:read"]}
        )
        assert key.status_code == 201, key.text
        denied_key = await viewer.post(
            "/v1/account/api-keys", json={"name": "write", "scopes": ["studio:write"]}
        )
        assert denied_key.status_code in {403, 422}
        rows = (await owner.get("/v1/account/workspaces/current/members")).json()["items"]
        target = next(row for row in rows if row["user_id"] == viewer_id)
        path = f"/v1/account/workspaces/current/members/{target['membership_id']}"
        changed = await owner.patch(
            path, json={"role": "admin", "expected_revision": target["revision"]}
        )
        assert changed.status_code == 200, changed.text
        assert (
            await owner.patch(
                path, json={"role": "member", "expected_revision": target["revision"]}
            )
        ).status_code == 409
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {key.json()['secret']}"},
        ) as keyed:
            assert (await keyed.get("/v1/files")).status_code == 401
        assert (await viewer.get("/v1/account/workspaces/current/audit-events")).status_code == 200
        assert (
            await viewer.post(
                "/v1/account/workspaces/current/invitations",
                json={"username": member_name, "role": "admin"},
            )
        ).status_code == 403
        second = await viewer.post(
            "/v1/account/workspaces/current/invitations",
            json={"username": member_name, "role": "member"},
        )
        assert second.status_code == 201, second.text
        inv2 = second.json()
        assert (
            await member.post(
                f"/v1/account/workspace-invitations/{inv2['id']}/accept",
                json={"expected_revision": inv2["revision"]},
            )
        ).status_code == 204
        await member.post("/v1/account/workspaces/switch", json={"workspace_id": workspace_id})
        assert (await member.get("/v1/llm-call-logs")).status_code == 403
        assert (await member.post("/v1/model-providers", json={})).status_code == 403
        assert (
            await member.post(
                "/v1/visual-workshop/projects", json={"title": "协作", "kind": "canvas"}
            )
        ).status_code == 200
        own_member = next(
            row
            for row in (await owner.get("/v1/account/workspaces/current/members")).json()["items"]
            if row["role"] == "owner"
        )
        assert (
            await viewer.request(
                "DELETE",
                f"/v1/account/workspaces/current/members/{own_member['membership_id']}",
                json={"expected_revision": own_member["revision"]},
            )
        ).status_code == 403


def test_every_business_operation_has_an_explicit_policy():
    paths = app.openapi()["paths"]
    actual = {
        (method.upper(), path)
        for path, methods in paths.items()
        for method in methods
        if path not in {"/health", "/ready"}
        and not path.startswith(("/v1/account", "/v1/auth", "/v1/platform", "/v1/public-workspace"))
    }
    account_logs = {
        ("GET", "/v1/account/log-workspaces"),
        ("GET", "/v1/account/cross-workspace-call-logs"),
        ("GET", "/v1/account/cross-workspace-call-logs/stats"),
    }
    assert actual | account_logs == set(ROUTE_PERMISSIONS)
    assert all(ROUTE_PERMISSIONS[route] == "logs.cross_workspace" for route in account_logs)
    assert all(path in paths for _, path in account_logs)


def test_fixed_role_and_scope_matrix():
    for role in ("owner", "admin", "member", "viewer"):
        access = "owner" if role == "owner" else "member"
        principal = StudioPrincipal(
            user_id="u",
            workspace_id="w",
            workspace_access=access,
            member_role=role,
            is_platform_admin=False,
            must_change_password=False,
            auth_kind="management_api_key",
            scopes=frozenset({"studio:read", "studio:private_read"}),
        )
        assert not principal.allows("content.write")
        assert principal.allows("content.read")
        assert ("studio:write" in role_scopes(access, role)) == (role != "viewer")
    assert not role_permissions("public_viewer", None)


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
async def test_invitation_conflicts_and_audit_privacy():
    import asyncio

    owner, _, _, _ = await client_account()
    invited, username, _, _ = await client_account()
    stranger, _, _, _ = await client_account()
    async with aclosing(owner), aclosing(invited), aclosing(stranger):
        invitation = (
            await owner.post(
                "/v1/account/workspaces/current/invitations", json={"username": username}
            )
        ).json()
        path = f"/v1/account/workspace-invitations/{invitation['id']}"
        hidden = await stranger.post(f"{path}/accept", json={"expected_revision": 999})
        assert hidden.status_code == 404 and "current" not in hidden.json()
        responses = await asyncio.gather(
            invited.post(f"{path}/accept", json={"expected_revision": invitation["revision"]}),
            owner.request(
                "DELETE",
                f"/v1/account/workspaces/current/invitations/{invitation['id']}",
                json={"expected_revision": invitation["revision"]},
            ),
        )
        assert sorted(r.status_code for r in responses) == [204, 409]
        audit = await owner.get(
            "/v1/account/workspaces/current/audit-events",
            params={
                "event_type": "workspace.invitation_created",
                "target_query": username,
                "page_size": 1,
            },
        )
        assert audit.status_code == 200 and audit.json()["total"] == 1
        assert not any(key in audit.text for key in ("password_hash", "csrf_hash", "token_hash"))


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


@pytest.mark.asyncio
async def test_realtime_auth_rechecks_member_role_after_downgrade():
    from fastapi import HTTPException
    from starlette.websockets import WebSocket

    from app.deps import authenticate_studio_websocket

    owner, _, _, workspace_id = await client_account()
    member, username, user_id, _ = await client_account()
    async with aclosing(owner), aclosing(member):
        invitation = (
            await owner.post(
                "/v1/account/workspaces/current/invitations", json={"username": username}
            )
        ).json()
        await member.post(
            f"/v1/account/workspace-invitations/{invitation['id']}/accept",
            json={"expected_revision": invitation["revision"]},
        )
        await member.post("/v1/account/workspaces/switch", json={"workspace_id": workspace_id})
        cookie = "; ".join(f"{k}={v}" for k, v in member.cookies.items())
        socket = WebSocket(
            {"type": "websocket", "headers": [(b"cookie", cookie.encode())]},
            AsyncMock(),
            AsyncMock(),
        )
        async with SessionLocal() as session:
            assert (await authenticate_studio_websocket(socket, session)).allows("models.use")
        membership = next(
            row
            for row in (await owner.get("/v1/account/workspaces/current/members")).json()["items"]
            if row["user_id"] == user_id
        )
        await owner.patch(
            f"/v1/account/workspaces/current/members/{membership['membership_id']}",
            json={"role": "viewer", "expected_revision": membership["revision"]},
        )
        async with SessionLocal() as session:
            with pytest.raises(HTTPException) as denied:
                await authenticate_studio_websocket(socket, session)
            assert denied.value.status_code == 403


@pytest.mark.asyncio
async def test_disable_restore_reset_and_invitation_decline():
    admin, _, _, _ = await client_account(admin=True)
    user, username, user_id, _ = await client_account()
    owner, _, _, _ = await client_account()
    async with aclosing(admin), aclosing(user), aclosing(owner):
        invitation = (
            await owner.post(
                "/v1/account/workspaces/current/invitations",
                json={"username": username, "role": "viewer"},
            )
        ).json()
        decline = await user.post(
            f"/v1/account/workspace-invitations/{invitation['id']}/decline",
            json={"expected_revision": invitation["revision"]},
        )
        assert decline.status_code == 204
        own = (await user.get("/v1/auth/me")).json()["user"]
        path = f"/v1/platform/accounts/{user_id}"
        disabled = await admin.patch(
            path, json={"status": "disabled", "expected_revision": own["revision"]}
        )
        assert disabled.status_code == 200
        assert (await user.get("/v1/auth/me")).status_code == 401
        restored = await admin.patch(
            path, json={"status": "active", "expected_revision": disabled.json()["revision"]}
        )
        assert restored.status_code == 200
        assert (await user.get("/v1/auth/me")).status_code == 401
        reset = await admin.post(
            f"{path}/reset-password", json={"expected_revision": restored.json()["revision"]}
        )
        assert reset.status_code == 200
        login = await user.post(
            "/v1/auth/login",
            json={"username": username, "password": reset.json()["temporary_password"]},
        )
        assert login.status_code == 200 and login.json()["must_change_password"] is True
