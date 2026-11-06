"""Real private HTTP delivery and independent databases, with lost acknowledgments."""

import asyncio
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

import httpx
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select, text

from studio.apps.identity.accounts import create_account
from studio.apps.identity.storage.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS
from studio.apps.identity.storage.service_models import AccountEvent
from studio.assembly.independent.identity.application import create_app
from studio.contracts.gateway.routing import RouteCatalog
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database
from studio.runtime.secrets import SecretCipher

assert not any(name.startswith(("studio.apps.model_service", "app.apps")) for name in sys.modules)
assert "studio.runtime.database.website" not in sys.modules


from studio.apps.model_service.account_events import (  # noqa: E402
    CatalogEventClient,
    CatalogEventTransportError,
    CatalogProvisioningRunner,
)
from studio.apps.model_service.provisioning import CatalogProvisioning  # noqa: E402
from studio.apps.model_service.storage.migrations.registry import (  # noqa: E402
    MIGRATIONS as MODELS_MIGRATIONS,  # noqa: E402
)
from studio.apps.model_service.storage.models.model_service import ModelProvider  # noqa: E402
from studio.apps.model_service.storage.service_models import (  # noqa: E402
    ACCOUNT_MODELS,
    MODELS,
    CatalogProvisioningReceipt,
)
from studio.apps.model_service.templates.policy import (  # noqa: E402
    RoleTemplates,
    initialize_account_catalog,
)
from studio.contracts.model_service.schemas.model_templates import RoleModelTemplateIn  # noqa: E402

cipher = SecretCipher(Fernet.generate_key().decode())

root = Path(os.environ["CATALOG_DELIVERY_TEST_ROOT"]).resolve()
assert root.is_relative_to(Path(tempfile.gettempdir()).resolve())
identity_root, models_root = root / "identity", root / "models"
apply(identity_root / "service.db", "identity", IDENTITY_MIGRATIONS)
apply(models_root / "service.db", "models", MODELS_MIGRATIONS)
models = Database("models", models_root, models=MODELS, account_models=ACCOUNT_MODELS)
model_token, agent_token = "model-fixture-credential-" * 3, "agent-fixture-credential-" * 3
management_token = "management-fixture-gateway-" * 3
identity = create_app(
    state_root=identity_root,
    catalog=RouteCatalog.read(Path("deploy/contracts/ownership.json")),
    gateway_token="studio-fixture-gateway-" * 3,
    management_gateway_token=management_token,
    local_origin="http://127.0.0.1:19000",
    public_origin="https://studio.example.test",
    management_local_origin="http://127.0.0.1:19002",
    private_key=Ed25519PrivateKey.generate(),
    service_credentials={"models": model_token, "tools": agent_token},
)


async def scenario():
    calls = []
    try:
        async with models.sessions() as session:
            for role in ("admin", "user"):
                await RoleTemplates(session).save(
                    role,
                    RoleModelTemplateIn(
                        expected_revision=0,
                        value={
                            "providers": [
                                {
                                    "template_key": "provider",
                                    "name": role + " policy",
                                    "kind": "openai",
                                    "base_url": "https://provider.invalid/v1",
                                    "api_key": "synthetic-" + role + "-policy-secret",
                                    "models": [
                                        {
                                            "template_key": "model",
                                            "slug": "fixture",
                                            "capabilities": ["chat"],
                                        }
                                    ],
                                }
                            ],
                            "defaults": {"chat": "model"},
                        },
                    ),
                    cipher=cipher,
                )
            await session.commit()
        async with identity.router.lifespan_context(identity):
            async with identity.state.database.sessions() as session:
                users = []
                for name, role in (
                    ("operator", "admin"),
                    ("downgraded", "admin"),
                    ("paused", "user"),
                ):
                    user, _ = await create_account(
                        session,
                        username="catalog-" + name,
                        display_name=name,
                        password="Synthetic-Catalog-Password-2026!",
                        platform_role=role,
                    )
                    users.append(user.id)
            transport = httpx.ASGITransport(app=identity)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:19002",
                headers={"X-Fpl-Gateway": management_token, "X-Fpl-Ingress": "local"},
            ) as admin:
                login = await admin.post(
                    "/v1/auth/login",
                    json={
                        "username": "catalog-operator",
                        "password": "Synthetic-Catalog-Password-2026!",
                    },
                )
                assert login.status_code == 200, login.text
                csrf = admin.cookies.get("fpl_management_csrf")
                unsafe = {"X-CSRF-Token": csrf, "Origin": "http://127.0.0.1:19002"}
                for owner, update in (
                    (users[1], {"platform_role": "user"}),
                    (users[2], {"status": "disabled"}),
                ):
                    changed = await admin.patch(
                        "/v1/platform/accounts/" + owner,
                        headers=unsafe,
                        json={"expected_revision": 0, **update},
                    )
                    assert changed.status_code == 200, changed.text
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://identity"
                ) as client:
                    path = "/_internal/v1/model-catalog/events"
                    auth = {"Authorization": "Bearer " + model_token}
                    forbidden = (
                        {},
                        {"Authorization": "Bearer " + agent_token},
                        {**auth, "Origin": "http://127.0.0.1:19002"},
                        {**auth, "Cookie": "fpl_management_session=browser"},
                    )
                    for headers in forbidden:
                        assert (await client.get(path, headers=headers)).status_code == 403
                    credentials = identity.state.identity_options["service_credentials"]
                    credentials.pop("models")
                    assert (await client.get(path, headers=auth)).status_code == 403
                    credentials["models"] = model_token
                    credentials["tools"] = model_token
                    assert (await client.get(path, headers=auth)).status_code == 403
                    credentials["tools"] = agent_token
                    pending = await client.get(path, headers=auth)
                    assert (
                        pending.status_code == 200
                        and pending.headers["cache-control"] == "no-store"
                    )
                    deliveries = pending.json()["events"]
                    assert len(deliveries) == 2
                    assert {item["account"]["user_id"] for item in deliveries} == set(users[:2])
                    downgraded = next(
                        item for item in deliveries if item["account"]["user_id"] == users[1]
                    )
                    assert downgraded["event"]["payload"]["platform_role"] == "admin"
                    assert downgraded["account"]["platform_role"] == "user"
                    assert "password" not in pending.text and "username" not in pending.text
                    assert (await client.get(path + "?limit=101", headers=auth)).status_code == 422
                    assert (
                        await client.post(path + "/unknown/ack", headers=auth, json={"revision": 0})
                    ).status_code == 409
                    assert (
                        await client.get("/v1/model-catalog/events", headers=auth)
                    ).status_code == 404
                    assert (await client.get(path + "/missing", headers=auth)).status_code == 404
                owner_by_event = {
                    item["event"]["id"]: item["account"]["user_id"] for item in deliveries
                }
                ordered_ids = [item["event"]["id"] for item in deliveries]

                async def initialize(session, owner, role):
                    calls.append((owner, role))
                    await initialize_account_catalog(session, owner, role)

                class LostAcknowledgments(httpx.AsyncBaseTransport):
                    before, after = True, True

                    async def handle_async_request(self, request):
                        if request.url.path.endswith("/ack"):
                            event_id = request.url.path.split("/")[-2]
                            owner = owner_by_event[event_id]
                            # Network entry observes committed Models state and no held writer lock.
                            async with models.sessions(info={"owner_user_id": owner}) as session:
                                await session.execute(text("BEGIN IMMEDIATE"))
                                assert (
                                    await session.get(CatalogProvisioningReceipt, event_id)
                                    is not None
                                )
                                await session.rollback()
                            if event_id == ordered_ids[0] and self.before:
                                self.before = False
                                raise httpx.ConnectError(
                                    "synthetic acknowledgment loss", request=request
                                )
                        response = await transport.handle_async_request(request)
                        if (
                            request.url.path.endswith("/ack")
                            and event_id == ordered_ids[1]
                            and self.after
                        ):
                            self.after = False
                            await response.aclose()
                            raise httpx.ReadError(
                                "synthetic committed acknowledgment loss", request=request
                            )
                        return response

                events = CatalogEventClient(credential=model_token, transport=LostAcknowledgments())
                consumer = CatalogProvisioning(models.sessions, initializer=initialize)
                runner = CatalogProvisioningRunner(client=events, provisioning=consumer)
                try:
                    for _ in range(2):
                        try:
                            await asyncio.wait_for(runner.process_once(), 3)
                        except CatalogEventTransportError:
                            pass
                        else:
                            raise AssertionError(
                                "The injected acknowledgment loss was not observed"
                            )
                    await runner.process_once()
                    assert await events.pending() == ()
                    assert sorted(calls) == sorted([(users[0], "admin"), (users[1], "user")])
                    for owner in users[:2]:
                        async with models.sessions(info={"owner_user_id": owner}) as session:
                            providers = list(await session.scalars(select(ModelProvider)))
                            assert len(providers) == 1
                            expected = "admin policy" if owner == users[0] else "user policy"
                            assert providers[0].name == expected
                    # Re-enable through the normal governance API;
                    # the retained event becomes visible again.
                    enabled = await admin.patch(
                        "/v1/platform/accounts/" + users[2],
                        headers=unsafe,
                        json={"expected_revision": 1, "status": "active"},
                    )
                    assert enabled.status_code == 200, enabled.text
                    extra = (await events.pending())[0]
                    assert extra.account.user_id == users[2]
                    owner_by_event[extra.event.id] = users[2]
                    await runner.process_once()
                    await events.acknowledge(extra.event)
                    assert await events.pending() == () and calls[-1] == (users[2], "user")
                    async with identity.state.database.sessions() as session:
                        rows = list(await session.scalars(select(AccountEvent)))
                        assert len(rows) == 3 and all(
                            row.delivered_at and row.revision == 1 for row in rows
                        )
                finally:
                    await events.close()
            assert not any(path.startswith("/_internal/") for path in identity.openapi()["paths"])
        for state, forbidden in (
            (identity_root, {"model_providers"}),
            (models_root, {"users", "auth_sessions"}),
        ):
            with sqlite3.connect(
                (state / "service.db").as_uri() + "?mode=ro", uri=True
            ) as readonly:
                tables = {
                    row[0]
                    for row in readonly.execute("SELECT name FROM sqlite_master WHERE type='table'")
                }
                assert not forbidden.intersection(tables)
                assert readonly.execute("PRAGMA integrity_check").fetchone() == ("ok",)
            readonly.close()
        assert (
            "studio.assembly.website.application" not in sys.modules
            and "studio.runtime.database.website" not in sys.modules
        )
    finally:
        await models.close()


asyncio.run(scenario())
