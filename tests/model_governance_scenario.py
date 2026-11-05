"""Real Identity sessions bind Models governance targets and WebSocket handshakes."""

import asyncio
import os
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from studio.apps.identity.accounts import create_account
from studio.apps.identity.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.identity.application import create_app
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import HEADER, verify_context
from studio.runtime.database.migrations import apply

state = Path(os.environ["MODEL_GOVERNANCE_ROOT"])
key = Ed25519PrivateKey.generate()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
models_credential = "models-fixture-credential-" * 3
app = create_app(
    state_root=state,
    catalog=catalog,
    gateway_token="gateway-fixture-token-" * 3,
    local_origin="http://127.0.0.1:19000",
    public_origin="https://studio.example.test",
    private_key=key,
    service_credentials={"models": models_credential, "agents": "agents-fixture-token-" * 3},
    management_gateway_token="management-fixture-token-" * 3,
    management_local_origin="http://127.0.0.1:19002",
    management_public_origin="https://management.example.test",
)
apply(state / "service.db", "identity", MIGRATIONS)


async def main():
    async with app.router.lifespan_context(app):
        async with app.state.database.sessions() as session:
            await create_account(
                session,
                username="fixture-admin",
                display_name="Fixture Admin",
                password="Synthetic-Password-2026!",
                platform_role="admin",
            )
            user, _ = await create_account(
                session,
                username="fixture-user",
                display_name="Fixture User",
                password="Synthetic-Password-2026!",
                platform_role="user",
            )
            target_id = user.id
        transport = httpx.ASGITransport(app=app)
        async with (
            httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:19000",
                headers={"X-Fpl-Gateway": "gateway-fixture-token-" * 3, "X-Fpl-Ingress": "local"},
            ) as studio,
            httpx.AsyncClient(
                transport=transport,
                base_url="http://identity",
                headers={"Authorization": "Bearer " + models_credential},
            ) as private,
        ):
            response = await studio.post(
                "/v1/auth/login",
                json={"username": "fixture-admin", "password": "Synthetic-Password-2026!"},
            )
            assert response.status_code == 200, response.text
            path = "/v1/model-test/realtime"
            socket_headers = {
                "X-Fpl-Target-Service": "models",
                "X-Fpl-Request-Method": "GET",
                "X-Fpl-Request-Uri": path,
            }
            assert (
                await studio.get("/_internal/v1/authorize", headers=socket_headers)
            ).status_code == 404
            socket_headers["X-Fpl-Request-Protocol"] = "websocket"
            response = await studio.get("/_internal/v1/authorize", headers=socket_headers)
            assert response.status_code == 204, response.text
            token = response.headers[HEADER]
            actor = verify_context(
                token, service="models", method="GET", path=path, public_key=key.public_key()
            )
            assert actor.auth_kind == "session" and actor.purpose == "studio"
            body = {"service": "models", "assertion": token, "method": "GET", "path": path}
            assert (await private.post("/_internal/v1/authorization/live", json=body)).json() == {
                "active": True
            }
            csrf = studio.cookies.get("fpl_csrf")
            unsafe = {"Origin": "http://127.0.0.1:19000", "X-CSRF-Token": csrf}
            created = await studio.post(
                "/v1/account/api-keys",
                headers=unsafe,
                json={"name": "Fixture", "scopes": ["studio:write"]},
            )
            assert created.status_code == 201, created.text
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:19000",
                headers={
                    "X-Fpl-Gateway": "gateway-fixture-token-" * 3,
                    "X-Fpl-Ingress": "local",
                    "Authorization": "Bearer " + created.json()["secret"],
                },
            ) as automation:
                assert (
                    await automation.get("/_internal/v1/authorize", headers=socket_headers)
                ).status_code == 403
            assert (await studio.post("/v1/auth/logout", headers=unsafe)).status_code == 204
            assert (await private.post("/_internal/v1/authorization/live", json=body)).json() == {
                "active": False
            }
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:19002",
                headers={
                    "X-Fpl-Gateway": "management-fixture-token-" * 3,
                    "X-Fpl-Ingress": "local",
                },
            ) as management:
                response = await management.post(
                    "/v1/auth/login",
                    json={"username": "fixture-admin", "password": "Synthetic-Password-2026!"},
                )
                assert response.status_code == 200, response.text
                csrf = management.cookies.get("fpl_management_csrf")
                unsafe = {"Origin": "http://127.0.0.1:19002", "X-CSRF-Token": csrf}
                source = "/v1/platform/model-service-templates/user/preview"
                response = await management.get(
                    "/_internal/v1/authorize",
                    headers={
                        **unsafe,
                        "X-Fpl-Target-Service": "models",
                        "X-Fpl-Request-Method": "POST",
                        "X-Fpl-Request-Uri": source,
                    },
                )
                assert response.status_code == 204, response.text
                token = response.headers[HEADER]
                body = {
                    "assertion": token,
                    "path": source,
                    "role": "user",
                    "account_ids": [target_id],
                }
                response = await private.post(
                    "/_internal/v1/model-governance/template-targets", json=body
                )
                assert response.status_code == 200, response.text
                data = response.json()
                assert data["active"] is True and data["targets"] == [
                    {"id": target_id, "display_name": "Fixture User", "revision": 0}
                ]
                assert "password" not in response.text and "email" not in response.text
                assert (
                    await private.post(
                        "/_internal/v1/model-governance/template-targets",
                        json={**body, "role": "admin"},
                    )
                ).status_code == 403
                assert (
                    await private.post(
                        "/_internal/v1/model-governance/template-targets",
                        json={**body, "owner_user_id": "forged"},
                    )
                ).status_code == 422
                assert (
                    await private.post(
                        "/_internal/v1/model-governance/template-targets",
                        json=body,
                        headers={"Origin": "https://browser.invalid"},
                    )
                ).status_code == 403
                from model_audit_scenario import exercise_audit

                await exercise_audit(app, management, private, token, source, state, unsafe)
                response = await private.post(
                    "/_internal/v1/model-governance/template-targets", json=body
                )
                assert (
                    response.status_code == 200
                    and response.json()["active"] is False
                    and response.json()["targets"] == []
                )


if __name__ == "__main__":
    asyncio.run(main())
