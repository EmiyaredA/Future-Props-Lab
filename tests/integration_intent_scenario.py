"""Real Identity enrollment binds opaque integration intents without retaining bearer proof."""

import asyncio
import hashlib
import os
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from app.llm.models import RuntimeAdmission
from external_intent_scenario import exercise_external_intents
from studio.apps.identity.accounts import create_account
from studio.apps.identity.storage.migrations.registry import MIGRATIONS
from studio.apps.identity.storage.service_models import IntegrationIntent
from studio.apps.integrations.clients.authority import IntegrationIntentClient
from studio.apps.model_service.admission.admission import ModelAdmission
from studio.apps.model_service.storage.integration_records import IntegrationCapacity
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS as MODEL_MIGRATIONS
from studio.assembly.independent.identity.application import create_app
from studio.assembly.independent.model_service.application import create_app as models_app
from studio.config.settings import Settings
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import HEADER
from studio.contracts.integrations.integration_intents import IntegrationScope
from studio.runtime.database.migrations import apply


async def main():
    root = Path(os.environ["INTEGRATION_INTENT_ROOT"])
    key = Ed25519PrivateKey.generate()
    credentials = {
        name: (name + "-integration-intent-fixture-") * 3
        for name in ("models", "thought", "integrations", "amadeus")
    }
    app = create_app(
        state_root=root,
        catalog=RouteCatalog.read(Path("deploy/contracts/ownership.json")),
        gateway_token="fixture-integration-gateway-" * 3,
        local_origin="http://127.0.0.1:19000",
        public_origin="https://studio.example.test",
        private_key=key,
        service_credentials=credentials,
    )
    apply(root / "service.db", "identity", MIGRATIONS)
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with app.state.database.sessions() as session:
            user, _ = await create_account(
                session,
                username="integration-user",
                display_name="Integration User",
                password="Synthetic-Integration-Password!",
                platform_role="user",
            )
            owner = user.id
        async with (
            httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:19000",
                headers={
                    "X-Fpl-Gateway": "fixture-integration-gateway-" * 3,
                    "X-Fpl-Ingress": "local",
                },
            ) as browser,
            httpx.AsyncClient(
                transport=transport,
                base_url="http://identity",
                headers={"Authorization": "Bearer " + credentials["integrations"]},
            ) as private,
        ):
            login = await browser.post(
                "/v1/auth/login",
                json={
                    "username": "integration-user",
                    "password": "Synthetic-Integration-Password!",
                },
            )
            assert login.status_code == 200, login.text
            unsafe = {
                "Origin": "http://127.0.0.1:19000",
                "X-CSRF-Token": browser.cookies.get("fpl_csrf"),
            }
            connection = str(uuid4())
            path = "/v1/integrations/mcp/" + connection + "/validate"
            authorized = await browser.get(
                "/_internal/v1/authorize",
                headers={
                    **unsafe,
                    "X-Fpl-Target-Service": "integrations",
                    "X-Fpl-Request-Method": "POST",
                    "X-Fpl-Request-Uri": path,
                },
            )
            assert authorized.status_code == 204, authorized.text
            token = authorized.headers[HEADER]
            request_id = uuid4()
            scope = IntegrationScope(
                kind="mcp.validate",
                task_id=request_id,
                connection_id=connection,
                connection_revision=3,
                input_sha256=hashlib.sha256(b"{}").hexdigest(),
            )
            client = IntegrationIntentClient(
                service="integrations", credential=credentials["integrations"], transport=transport
            )
            models = IntegrationIntentClient(
                service="models", credential=credentials["models"], transport=transport
            )
            try:
                receipt = await client.enroll(
                    request_id=request_id, assertion=token, method="POST", path=path, scope=scope
                )
                same = await client.enroll(
                    request_id=request_id, assertion=token, method="POST", path=path, scope=scope
                )
                assert same == receipt
                decision = await client.check(receipt.id)
                assert (
                    decision.allowed and decision.actor.user_id == owner and decision.scope == scope
                )
                assert (await models.check(receipt.id)).allowed
                # Exercise the actual Models quota ledger through a target-bound grant.
                model_root = root / "models"
                model_root.mkdir()
                apply(model_root / "service.db", "models", MODEL_MIGRATIONS)

                async def close():
                    pass

                inert = SimpleNamespace(close=close)
                model_app = models_app(
                    settings=Settings(
                        _config_file=None, fpl_database_path=str(model_root / "service.db")
                    ),
                    catalog=app.state.service_catalog,
                    public_key=key.public_key(),
                    identity=inert,
                    capabilities=inert,
                    events=inert,
                    directory=inert,
                    audit=inert,
                    integration_intents=models,
                    run_tasks=False,
                )
                model_http = httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=model_app), base_url="http://models"
                )
                grant = await client.capacity_grant(receipt.id, "acquire")
                acquire_path = f"/_internal/v1/integration-capacity/{receipt.id}/acquire"
                for _ in range(2):
                    acquired = await model_http.post(acquire_path, headers={HEADER: grant})
                    assert acquired.status_code == 200, acquired.text
                    assert acquired.json() == {"accepted": True, "released": False}
                await ModelAdmission(model_app.state.database.sessions).recover()
                async with model_app.state.database.sessions(
                    info={"owner_user_id": owner}
                ) as session:
                    leases = list(await session.scalars(select(RuntimeAdmission)))
                    assert len(leases) == 1 and leases[0].released_at is None
                    assert leases[0].task_kind == "integration-validation"
                wrong = await model_http.post(
                    acquire_path.replace("acquire", "release"),
                    headers={HEADER: grant},
                    json={"outcome": "completed"},
                )
                assert wrong.status_code == 401
                await model_http.aclose()
                body = {
                    "caller": "integrations",
                    "request_id": str(request_id),
                    "assertion": token,
                    "source_method": "POST",
                    "source_path": path,
                    "scope": scope.model_dump(mode="json"),
                }
                conflict = {**body, "scope": {**body["scope"], "input_sha256": "0" * 64}}
                assert (
                    await private.post("/_internal/v1/integration-intents", json=conflict)
                ).status_code == 409
                mismatch = {
                    **body,
                    "request_id": str(uuid4()),
                    "scope": {**body["scope"], "connection_id": "another"},
                }
                assert (
                    await private.post("/_internal/v1/integration-intents", json=mismatch)
                ).status_code == 403
                assert (
                    await private.post(
                        "/_internal/v1/integration-intents",
                        json={**body, "owner_user_id": "forged"},
                    )
                ).status_code == 422
                assert (
                    await private.post(
                        "/_internal/v1/integration-intents",
                        json=body,
                        headers={"Cookie": "fpl_session=browser"},
                    )
                ).status_code == 403
                assert (
                    await private.post(
                        "/_internal/v1/integration-intents",
                        json=body,
                        headers={"Authorization": "Bearer " + credentials["models"]},
                    )
                ).status_code == 403
                async with app.state.database.sessions() as session:
                    rows = list(await session.scalars(select(IntegrationIntent)))
                    assert len(rows) == 1 and rows[0].actor["user_id"] == owner
                    assert token not in str(rows[0].actor) and token not in str(rows[0].scope)
                    assert not any(
                        "assertion" in column.name for column in IntegrationIntent.__table__.columns
                    )
                (
                    thought,
                    external_receipt,
                    external_step,
                    read_token,
                    read_target,
                ) = await exercise_external_intents(
                    browser, private, transport, unsafe, key, credentials, owner
                )
                assert (await browser.post("/v1/auth/logout", headers=unsafe)).status_code == 204
                assert not (await thought.check(external_receipt.id)).allowed
                denied_external = await private.post(
                    "/_internal/v1/integration-intents/external-grant",
                    json=external_step.model_dump(mode="json"),
                    headers={"Authorization": "Bearer " + credentials["thought"]},
                )
                assert denied_external.status_code == 401, denied_external.text
                revoked_read = await private.post(
                    "/_internal/v1/authorization/live",
                    json={
                        "service": "integrations",
                        "assertion": read_token,
                        "method": "POST",
                        "path": read_target,
                    },
                )
                assert revoked_read.status_code == 200 and revoked_read.json() == {"active": False}
                await thought.close()
                assert not (await client.check(receipt.id)).allowed
                denied_grant = await private.post(
                    "/_internal/v1/integration-intents/capacity-grant",
                    json={"intent_id": str(receipt.id), "operation": "acquire"},
                )
                assert denied_grant.status_code == 401, denied_grant.text
                # Terminal settlement remains possible after logout and does not authorize work.
                release_grant = await client.capacity_grant(receipt.id, "release")
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=model_app), base_url="http://models"
                ) as model_http:
                    released = await model_http.post(
                        f"/_internal/v1/integration-capacity/{receipt.id}/release",
                        headers={HEADER: release_grant},
                        json={"outcome": "completed"},
                    )
                    assert released.status_code == 200, released.text
                    assert released.json() == {"released": True}
                async with model_app.state.database.sessions(
                    info={"owner_user_id": owner}
                ) as session:
                    lease = await session.scalar(select(RuntimeAdmission))
                    stored = await session.scalar(select(IntegrationCapacity))
                    assert lease.released_at and stored.outcome == "completed"
                await model_app.state.database.close()
                # Re-obtaining an old inert id cannot reactivate it or change scope.
                assert (
                    await client.enroll(
                        request_id=request_id,
                        assertion=token,
                        method="POST",
                        path=path,
                        scope=scope,
                    )
                    == receipt
                )
                new = {**body, "request_id": str(uuid4())}
                assert (
                    await private.post("/_internal/v1/integration-intents", json=new)
                ).status_code == 401
            finally:
                await client.close()
                await models.close()


if __name__ == "__main__":
    asyncio.run(main())
