"""Fresh-process integration scenario for the account-only ASGI application."""

import asyncio
import os
import sys
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from fpl_identity.accounts import create_account
from fpl_identity.application import create_app
from fpl_identity.migrations.registry import MIGRATIONS
from fpl_identity.models import AccountEvent
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog

state = Path(os.environ["IDENTITY_TEST_ROOT"])
assert "app.main" not in sys.modules
assert "app.api" not in sys.modules
assert "app.orm" not in sys.modules
assert not any(name.startswith("app.llm") or name.startswith("app.apps") for name in sys.modules)

private = Ed25519PrivateKey.generate()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
app = create_app(
    state_root=state,
    catalog=catalog,
    gateway_token="test-gateway-token-" * 3,
    local_origin="http://127.0.0.1:19000",
    public_origin="https://studio.example.test",
    private_key=private,
    service_credentials={"agents": "agents-test-service-credential-123456"},
)
apply(state / "service.db", "identity", MIGRATIONS)
transport = httpx.ASGITransport(app=app)
headers = {
    "X-Fpl-Gateway": "test-gateway-token-" * 3,
    "X-Fpl-Ingress": "local",
    "X-Fpl-Client-Ip": "127.0.0.1",
}
password = "Identity-Test-Password-2026!"


async def scenario():
    async with app.router.lifespan_context(app):
        async with app.state.database.sessions() as session:
            user, _ = await create_account(
                session,
                username="identity-admin",
                display_name="Identity Admin",
                password=password,
                platform_role="admin",
            )
            owner = user.id
            events = list(await session.scalars(select(AccountEvent)))
            assert len(events) == 1 and events[0].payload["user_id"] == owner
        async with httpx.AsyncClient(
            transport=transport, base_url="http://127.0.0.1:19000", headers=headers
        ) as client:
            login = await client.post(
                "/v1/auth/login", json={"username": "identity-admin", "password": password}
            )
            assert login.status_code == 200, login.text
            assert login.json()["user"]["id"] == owner
            assert (await client.get("/v1/auth/me")).status_code == 200
            assert (await client.get("/v1/platform/accounts")).status_code == 200
            csrf = client.cookies.get("fpl_csrf")
            unsafe = {"X-CSRF-Token": csrf, "Origin": "http://127.0.0.1:19000"}
            rejected = await client.post("/v1/auth/logout")
            assert rejected.status_code == 403
            assert (await client.get("/v1/not-a-real-operation")).status_code == 404
            assert (await client.get("/v1/model-entries")).status_code == 404
            auth_headers = {
                "X-Fpl-Target-Service": "agents",
                "X-Fpl-Request-Method": "GET",
                "X-Fpl-Request-Uri": "/v1/agent-workbench/sessions",
                "X-Fpl-Context": "forged-context",
            }
            authorized = await client.get("/_internal/v1/authorize", headers=auth_headers)
            assert authorized.status_code == 204, authorized.text
            actor = verify_context(
                authorized.headers[HEADER],
                service="agents",
                method="GET",
                path="/v1/agent-workbench/sessions",
                public_key=private.public_key(),
            )
            assert actor.user_id == owner and actor.local
            assert actor.reauthenticated_at is not None
            live_body = {
                "service": "agents",
                "method": "GET",
                "path": "/v1/agent-workbench/sessions",
                "assertion": authorized.headers[HEADER],
            }
            live_headers = {"Authorization": "Bearer agents-test-service-credential-123456"}
            live = await client.post(
                "/_internal/v1/authorization/live", json=live_body, headers=live_headers
            )
            assert live.status_code == 200 and live.json()["active"] is True
            task_body = {"service": "agents", "owner_user_id": owner, "permission": "content.read"}
            task = await client.post(
                "/_internal/v1/tasks/authorize", json=task_body, headers=live_headers
            )
            assert task.status_code == 200 and task.json()["allowed"] is True
            assert type(task.json()["revision"]) is int
            forbidden = await client.post(
                "/_internal/v1/tasks/authorize",
                json={**task_body, "permission": "configuration.manage"},
                headers=live_headers,
            )
            assert forbidden.status_code == 403
            anonymous = await client.post("/_internal/v1/tasks/authorize", json=task_body)
            assert anonymous.status_code == 403
            unknown_owner = await client.post(
                "/_internal/v1/tasks/authorize",
                json={**task_body, "owner_user_id": "absent"},
                headers=live_headers,
            )
            assert unknown_owner.status_code == 200 and unknown_owner.json()["allowed"] is False
            unauthenticated_live = await client.post(
                "/_internal/v1/authorization/live", json=live_body
            )
            assert unauthenticated_live.status_code == 403
            forged = await client.get(
                "/_internal/v1/authorize", headers={**auth_headers, "X-Fpl-Gateway": "untrusted"}
            )
            assert forged.status_code == 403
            wrong_service = await client.get(
                "/_internal/v1/authorize",
                headers={**auth_headers, "X-Fpl-Target-Service": "remote"},
            )
            assert wrong_service.status_code == 403
            created = await client.post(
                "/v1/platform/accounts",
                headers=unsafe,
                json={
                    "username": "second-account",
                    "display_name": "Second Account",
                    "email": "",
                    "platform_role": "user",
                },
            )
            assert created.status_code == 201, created.text
            async with app.state.database.sessions() as session:
                events = list(await session.scalars(select(AccountEvent)))
                assert len(events) == 2
            logout = await client.post("/v1/auth/logout", headers=unsafe)
            assert logout.status_code == 204, logout.text
            revoked = await client.get("/_internal/v1/authorize", headers=auth_headers)
            assert revoked.status_code == 401
            live = await client.post(
                "/_internal/v1/authorization/live", json=live_body, headers=live_headers
            )
            assert live.status_code == 200 and live.json()["active"] is False

        async with httpx.AsyncClient(
            transport=transport, base_url="http://127.0.0.1:19000"
        ) as direct:
            response = await direct.post(
                "/v1/auth/login",
                headers={"X-Fpl-Ingress": "local"},
                json={"username": "identity-admin", "password": password},
            )
            assert response.status_code == 403
        async with httpx.AsyncClient(
            transport=transport,
            base_url="https://studio.example.test",
            headers={**headers, "X-Fpl-Ingress": "public"},
        ) as public:
            login = await public.post(
                "/v1/auth/login", json={"username": "identity-admin", "password": password}
            )
            assert login.status_code == 200, login.text
            assert all(
                "; secure" in value.lower() for value in login.headers.get_list("set-cookie")
            )
            assert (await public.get("/v1/auth/me")).status_code == 200
            spoof = await public.get("/v1/auth/me", headers={"X-Fpl-Ingress": "local"})
            assert spoof.status_code == 403
            assert login.headers["Cache-Control"] == "no-store"

        async with app.state.database.engine.connect() as connection:
            names = set(
                (
                    await connection.exec_driver_sql(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                ).scalars()
            )
            assert names == {
                "users",
                "auth_sessions",
                "management_api_keys",
                "security_audit_events",
                "registration_invite_codes",
                "registration_redemptions",
                "identity_account_events",
                "_fpl_service_schema",
            }, names
    assert "app.main" not in sys.modules and "app.orm" not in sys.modules
    assert not any(
        name.startswith("app.llm") or name.startswith("app.apps") for name in sys.modules
    )


asyncio.run(scenario())
print("Identity isolated accounts, sessions, CSRF, assertions and durable events passed")
