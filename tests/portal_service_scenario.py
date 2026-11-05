"""Fresh Portal process loads no account or workshop database implementation."""

import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from studio.apps.portal.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.portal.application import create_app
from studio.contracts.gateway.protocol_hash import public_contract
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.runtime.database.migrations import apply

assert (
    "studio.assembly.website.models" not in sys.modules
    and "studio.assembly.website.application" not in sys.modules
)
assert not any(
    name.startswith(("app.apps.", "app.console.models", "app.llm.")) for name in sys.modules
)
state = Path(os.environ["PORTAL_TEST_ROOT"])
key = Ed25519PrivateKey.generate()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
apply(state / "service.db", "portal", MIGRATIONS)
app = create_app(state_root=state, catalog=catalog, public_key=key.public_key())
path = "/v1/account/developer-documents"
canonical = json.loads(Path("web/src/generated/openapi.json").read_text())
assert public_contract(app.openapi(), "portal", catalog) == public_contract(
    canonical, "portal", catalog
)


def headers(*, api_key=False):
    actor = Actor(
        "alpha",
        "user",
        "management_api_key" if api_key else "session",
        ("studio:read", "studio:private_read", "studio:write"),
        session_id=None if api_key else "owned-session",
        api_key_id="owned-key" if api_key else None,
    )
    return {
        "X-Fpl-Context": issue_context(
            actor, service="portal", method="GET", path=path, private_key=key, key_id="test"
        )
    }


async def journey():
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://portal"
        ) as client:
            assert (await client.get("/ready")).status_code == 200
            assert (await client.get(path)).status_code == 401
            denied = await client.get(path, headers=headers(api_key=True))
            assert denied.status_code == 403 and denied.json()["code"] == "browser_session_required"
            result = await client.get(path, headers=headers())
            assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
            assert any(item["id"] == "dev-README" for item in result.json()["items"])
            assert not any(item["source"].endswith("/api.md") for item in result.json()["items"])
            assert (
                await client.get("/v1/agent-workbench/sources", headers=headers())
            ).status_code == 404
            async with app.state.database.engine.connect() as connection:
                assert set(
                    (
                        await connection.exec_driver_sql(
                            "SELECT name FROM sqlite_master WHERE type='table'"
                        )
                    ).scalars()
                ) == {"_fpl_service_schema"}


asyncio.run(journey())
print("Portal preserves browser-only document access and has no foreign storage")
