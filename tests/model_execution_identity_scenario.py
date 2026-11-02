"""Fresh Identity HTTP credentials authorize immutable jobs in a separate Models database."""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from fpl_identity.accounts import create_account
from fpl_identity.application import create_app
from fpl_identity.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS
from fpl_runtime.claims import verify_context
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog

assert "app.runtime.db" not in sys.modules
assert not any(name.startswith(("app.llm", "app.apps")) for name in sys.modules)

from app.llm.generation_runtime.driver import GenerationTaskStore  # noqa: E402
from app.llm.models import ModelInferenceTask, ModelProvider  # noqa: E402
from app.runtime.credentials import encrypt_secret  # noqa: E402
from fpl_models.execution_authority import ModelTaskAuthority  # noqa: E402
from fpl_models.migrations.registry import MIGRATIONS as MODELS_MIGRATIONS  # noqa: E402
from fpl_models.models import ACCOUNT_MODELS, MODELS  # noqa: E402
from fpl_runtime.database import Database  # noqa: E402

root = Path(os.environ["MODEL_EXECUTION_IDENTITY_ROOT"]).resolve()
assert root.is_relative_to(Path(tempfile.gettempdir()).resolve())
identity_root, models_root = root / "identity", root / "models"
apply(identity_root / "service.db", "identity", IDENTITY_MIGRATIONS)
apply(models_root / "service.db", "models", MODELS_MIGRATIONS)
models = Database("models", models_root, models=MODELS, account_models=ACCOUNT_MODELS)
key = Ed25519PrivateKey.generate()
catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
credential = "models-private-execution-fixture-" * 3
studio_token, admin_token = "studio-gateway-fixture-" * 3, "admin-gateway-fixture-" * 3
origin, admin_origin = "http://127.0.0.1:19000", "http://127.0.0.1:19002"
source_path = "/v1/model-inference/tasks"
password = "Synthetic-Execution-Password-2026!"
identity = create_app(
    state_root=identity_root,
    catalog=catalog,
    gateway_token=studio_token,
    management_gateway_token=admin_token,
    local_origin=origin,
    public_origin="https://studio.example.test",
    management_local_origin=admin_origin,
    private_key=key,
    service_credentials={"models": credential},
)
transport = httpx.ASGITransport(app=identity)
live = LiveAuthorization(service="models", credential=credential, transport=transport)
authority = ModelTaskAuthority(
    models.sessions, public_key=key.public_key(), catalog=catalog, identity=live
)


def unsafe(client, *, admin=False):
    return {
        "Origin": admin_origin if admin else origin,
        "X-CSRF-Token": client.cookies.get("fpl_management_csrf" if admin else "fpl_csrf"),
    }


async def assertion(client, *, secret=None):
    headers = {
        "X-Fpl-Target-Service": "models",
        "X-Fpl-Request-Method": "POST",
        "X-Fpl-Request-Uri": source_path,
    }
    if secret:
        headers["Authorization"] = "Bearer " + secret
    else:
        headers.update(unsafe(client))
    result = await client.get("/_internal/v1/authorize", headers=headers)
    assert result.status_code == 204, result.text
    token = result.headers["X-Fpl-Context"]
    actor = verify_context(
        token, service="models", method="POST", path=source_path, public_key=key.public_key()
    )
    return token, actor


async def accept(identity, proof):
    token, actor = proof
    async with models.sessions(info={"owner_user_id": actor.user_id}) as session:
        provider_id = "provider-" + actor.user_id
        if await session.get(ModelProvider, provider_id) is None:
            session.add(
                ModelProvider(
                    id=provider_id,
                    owner_user_id=actor.user_id,
                    name="Fixture",
                    kind="openai",
                    base_url="https://provider.invalid/v1",
                    api_key_ciphertext=encrypt_secret("synthetic-provider-key"),
                )
            )
            await session.flush()
        session.add(
            ModelInferenceTask(
                id=identity,
                owner_user_id=actor.user_id,
                request_id=identity,
                fingerprint="f" * 64,
                provider_id=provider_id,
                provider_kind="openai",
                provider_name="Fixture",
                model_slug="fixture",
                kind="image",
                request_payload={},
            )
        )
        await authority.retain(
            session,
            assertion=token,
            actor=actor,
            method="POST",
            path=source_path,
            kind="inference",
            task_ids=[identity],
        )
        await session.commit()


async def prepare(task_id):
    return await authority.prepare("inference", task_id)


store = GenerationTaskStore(
    session_factory=models.sessions,
    task_type=ModelInferenceTask,
    active_statuses=("queued", "submitting", "pending", "processing"),
    task_subject="model job",
    prepare_claim=prepare,
)


async def scenario():
    clients = []
    try:
        async with identity.router.lifespan_context(identity):
            async with identity.state.database.sessions() as session:
                for name, role in (("operator", "admin"), ("worker", "user")):
                    await create_account(
                        session,
                        username=name,
                        display_name=name,
                        password=password,
                        platform_role=role,
                    )
            for base, token in ((admin_origin, admin_token), (origin, studio_token)):
                clients.append(
                    httpx.AsyncClient(
                        transport=transport,
                        base_url=base,
                        headers={"X-Fpl-Gateway": token, "X-Fpl-Ingress": "local"},
                    )
                )
            admin, browser = clients
            for client, username in ((admin, "operator"), (browser, "worker")):
                response = await client.post(
                    "/v1/auth/login", json={"username": username, "password": password}
                )
                assert response.status_code == 200, response.text
            proof = await assertion(browser)
            owner = proof[1].user_id
            await accept("already-submitted", proof)
            await accept("after-logout", proof)
            assert (await store.claim("already-submitted")).status == "queued"
            await store.mark_submitted("already-submitted", "original-supplier-id")
            logged_out = await browser.post("/v1/auth/logout", headers=unsafe(browser))
            assert logged_out.status_code == 204, logged_out.text
            assert await store.claim("after-logout") is None
            pending = await store.claim("already-submitted")
            assert (
                pending.status == "pending" and pending.provider_task_id == "original-supplier-id"
            )

            response = await browser.post(
                "/v1/auth/login", json={"username": "worker", "password": password}
            )
            assert response.status_code == 200, response.text
            proof = await assertion(browser)
            await accept("after-disable", proof)
            disabled = await admin.patch(
                "/v1/platform/accounts/" + owner,
                headers=unsafe(admin, admin=True),
                json={"expected_revision": 0, "status": "disabled"},
            )
            assert disabled.status_code == 200, disabled.text
            assert await store.claim("after-disable") is None
            enabled = await admin.patch(
                "/v1/platform/accounts/" + owner,
                headers=unsafe(admin, admin=True),
                json={"expected_revision": 1, "status": "active"},
            )
            assert enabled.status_code == 200, enabled.text
            promoted = await admin.patch(
                "/v1/platform/accounts/" + owner,
                headers=unsafe(admin, admin=True),
                json={"expected_revision": 2, "platform_role": "admin"},
            )
            assert promoted.status_code == 200, promoted.text
            response = await browser.post(
                "/v1/auth/login", json={"username": "worker", "password": password}
            )
            assert response.status_code == 200, response.text
            proof = await assertion(browser)
            assert proof[1].platform_role == "admin"
            await accept("after-role-change", proof)
            downgraded = await admin.patch(
                "/v1/platform/accounts/" + owner,
                headers=unsafe(admin, admin=True),
                json={"expected_revision": 3, "platform_role": "user"},
            )
            assert downgraded.status_code == 200, downgraded.text
            assert await store.claim("after-role-change") is None
            response = await browser.post(
                "/v1/auth/login", json={"username": "worker", "password": password}
            )
            assert response.status_code == 200, response.text
            created = await browser.post(
                "/v1/account/api-keys",
                headers=unsafe(browser),
                json={
                    "name": "Fixture execution",
                    "scopes": ["studio:write"],
                    "expires_in_days": 7,
                },
            )
            assert created.status_code == 201, created.text
            api_key = created.json()
            # An API Key source goes through the actual automation whitelist and Identity.
            async with httpx.AsyncClient(
                transport=transport,
                base_url=origin,
                headers={"X-Fpl-Gateway": studio_token, "X-Fpl-Ingress": "local"},
            ) as cli:
                proof = await assertion(cli, secret=api_key["secret"])
            assert proof[1].auth_kind == "management_api_key"
            await accept("after-key-revoke", proof)
            revoked = await browser.post(
                "/v1/account/api-keys/" + api_key["api_key"]["id"] + "/revoke",
                headers=unsafe(browser),
                json={"expected_revision": 0},
            )
            assert revoked.status_code == 200, revoked.text
            assert await store.claim("after-key-revoke") is None
            async with httpx.AsyncClient(transport=transport, base_url=origin) as raw:
                arbitrary = await raw.post(
                    "/_internal/v1/tasks/authorize",
                    headers={"Authorization": "Bearer " + credential},
                    json={"service": "models", "owner_user_id": owner, "permission": "models.use"},
                )
                assert arbitrary.status_code == 403
            async with models.sessions(info={"owner_user_id": owner}) as session:
                rows = list(await session.scalars(select(ModelInferenceTask)))
                assert {row.id for row in rows if row.status == "failed"} == {
                    "after-logout",
                    "after-disable",
                    "after-key-revoke",
                    "after-role-change",
                }
            assert "app.runtime.db" not in sys.modules
            assert "app.orm" not in sys.modules
    finally:
        for client in clients:
            await client.aclose()
        await live.close()
        await models.close()


asyncio.run(scenario())
