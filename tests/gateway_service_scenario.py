"""Fresh-process Gateway business checks with mocked owning-service interfaces."""

import asyncio
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from fpl_gateway.application import create_app
from fpl_gateway.migrations.registry import MIGRATIONS
from fpl_runtime.claims import Actor, issue_context, verify_context
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog

assert "app.main" not in sys.modules and "app.orm" not in sys.modules
assert "app.console.models.accounts" not in sys.modules
assert not any(name.startswith(("app.apps.", "app.llm.")) for name in sys.modules)

state = Path(os.environ["GATEWAY_TEST_ROOT"])
key = Ed25519PrivateKey.generate()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
schema = json.loads(Path("web/src/generated/openapi.json").read_text())
manifest = json.loads(Path("backend/app/console/governance/automation_operations.json").read_text())


class Capabilities:
    calls = []

    async def resource_exists(self, *, assertion, target_service, target_path):
        actor = verify_context(
            assertion,
            service="gateway",
            method="POST",
            path="/v1/automation/open",
            public_key=key.public_key(),
        )
        self.calls.append((actor.user_id, target_service, target_path))
        return actor.user_id == "alpha" and target_path.endswith("/owned")

    async def close(self):
        pass


capabilities = Capabilities()
app = create_app(
    state_root=state,
    catalog=catalog,
    public_key=key.public_key(),
    capabilities=capabilities,
    schema=schema,
    manifest=manifest,
    publishers={"models": "test-publisher-" * 3},
)
apply(state / "service.db", "gateway", MIGRATIONS)


def headers(method, path, *, owner="alpha", local=True, admin=False, readonly=False):
    actor = Actor(
        owner,
        "admin" if admin else "user",
        "session",
        ("studio:read", "studio:private_read")
        if readonly
        else ("studio:read", "studio:private_read", "studio:write"),
        session_id="session-" + owner,
        local=local,
    )
    return {
        "X-Fpl-Context": issue_context(
            actor,
            service="gateway",
            method=method,
            path=path,
            private_key=key,
            key_id="test",
        )
    }


async def journey():
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://gateway"
        ) as client:
            path = "/v1/automation/runtime"
            assert (await client.get(path)).status_code == 401
            assert (await client.get(path, headers=headers("GET", path))).json() == {
                "local_browser": True
            }
            assert (await client.get(path, headers=headers("GET", path, local=False))).json() == {
                "local_browser": False
            }
            path = "/v1/automation/capabilities"
            response = await client.get(path, headers=headers("GET", path))
            assert response.status_code == 200 and response.json()["owner_user_id"] == "alpha"
            assert len(response.json()["operations"]) == len(manifest["operations"])
            path = "/v1/automation/open"
            response = await client.post(
                path, headers=headers("POST", path), json={"kind": "visual", "resource_id": "owned"}
            )
            assert response.status_code == 200
            assert response.json()["path"] == "/apps/visual-workshop/projects/owned/canvas"
            other = await client.post(
                path,
                headers=headers("POST", path, owner="beta"),
                json={"kind": "visual", "resource_id": "owned"},
            )
            assert other.status_code == 404
            denied = await client.post(
                path,
                headers=headers("POST", path, readonly=True),
                json={"kind": "skill", "view": "upload"},
            )
            assert denied.status_code == 403
            path = "/v1/automation/access"
            assert (
                await client.get(path, headers=headers("GET", path, local=False, admin=True))
            ).status_code == 403
            assert (
                await client.get(path, headers=headers("GET", path, admin=False))
            ).status_code == 403
            assert (
                await client.get(path, headers=headers("GET", path, admin=True))
            ).status_code == 503
            event = {"service": "models", "event_id": str(uuid4()), "owner_user_id": "alpha"}
            private_path = "/_internal/v1/change-events"
            assert (await client.post(private_path, json=event)).status_code == 403
            publisher = {"Authorization": "Bearer " + "test-publisher-" * 3}
            first = await client.post(private_path, headers=publisher, json=event)
            second = await client.post(private_path, headers=publisher, json=event)
            assert first.json() == second.json() == {"acknowledged": True, "revision": 1}
            conflict = await client.post(
                private_path, headers=publisher, json={**event, "owner_user_id": "beta"}
            )
            assert conflict.status_code == 409
            path = "/v1/automation/changes"
            assert (await client.get(path, headers=headers("GET", path))).json() == {"revision": 1}
            assert (await client.get(path, headers=headers("GET", path, owner="beta"))).json() == {
                "revision": 0
            }
            assert (
                await client.get("/v1/model-entries", headers=headers("GET", path))
            ).status_code == 404
            async with app.state.database.engine.connect() as connection:
                tables = set(
                    (
                        await connection.exec_driver_sql(
                            "SELECT name FROM sqlite_master WHERE type='table'"
                        )
                    ).scalars()
                )
                assert tables == {
                    "gateway_change_cursors",
                    "gateway_change_receipts",
                    "_fpl_service_schema",
                }


asyncio.run(journey())
print("Independent gateway authorization, resource ownership and durable notifications passed")
