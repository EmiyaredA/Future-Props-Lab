"""Three isolated services use real Identity grants for fixed demo installation and validation."""

import asyncio
import json
import os
from contextlib import AsyncExitStack
from pathlib import Path
from types import SimpleNamespace

import httpx
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from app.console.models.accounts import SecurityAuditEvent
from app.integrations.models import ToolApiIntegration
from app.llm.models import RuntimeAdmission
from app.runtime.config import Settings
from studio.apps.identity.accounts import create_account
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.identity.storage.migrations.registry import MIGRATIONS as IDENTITY_MIGRATIONS
from studio.apps.integrations.clients.authority import IntegrationIntentClient
from studio.apps.integrations.storage.demo_records import DemoToolInstallation
from studio.apps.integrations.storage.migrations.registry import (
    MIGRATIONS as INTEGRATION_MIGRATIONS,
)
from studio.apps.integrations.validation import ValidationCapacityClient
from studio.apps.model_service.audit.audit_client import ModelAuditClient
from studio.apps.model_service.audit.audit_delivery import ModelAuditDelivery
from studio.apps.model_service.demo_installations import DemoInstallClient
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS as MODEL_MIGRATIONS
from studio.apps.model_service.templates import initialize_account_catalog
from studio.assembly.independent.identity.application import create_app as identity_app
from studio.assembly.independent.integrations.application import create_app as integrations_app
from studio.assembly.independent.model_service.application import create_app as models_app
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import HEADER
from studio.runtime.database.migrations import apply
from studio.runtime.http.capability_client import CapabilityClient


class Mesh(httpx.AsyncBaseTransport):
    def __init__(self):
        self.apps = {}
        self.lose_install_reply = True

    async def handle_async_request(self, request):
        response = await httpx.ASGITransport(app=self.apps[request.url.host]).handle_async_request(
            request
        )
        if (
            request.url.host == "integrations"
            and request.method == "POST"
            and request.url.path.startswith("/_internal/v1/demo-tool-installations/")
            and self.lose_install_reply
        ):
            self.lose_install_reply = False
            await response.aclose()
            raise httpx.ReadTimeout("synthetic committed install reply lost", request=request)
        return response


async def main():
    root = Path(os.environ["DEMO_TOOLS_ROOT"])
    catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
    key = Ed25519PrivateKey.generate()
    credentials = {
        name: (name + "-demo-fixture-service-") * 3 for name in ("models", "integrations")
    }
    mesh = Mesh()
    identity = identity_app(
        state_root=root / "identity",
        catalog=catalog,
        gateway_token="studio-demo-fixture-" * 3,
        management_gateway_token="management-demo-fixture-" * 3,
        local_origin="http://127.0.0.1:19000",
        public_origin="https://studio.example.test",
        management_local_origin="http://127.0.0.1:19002",
        management_public_origin="https://management.example.test",
        private_key=key,
        service_credentials=credentials,
    )
    apply(root / "identity/service.db", "identity", IDENTITY_MIGRATIONS)
    mesh.apps["identity"] = identity

    async def close():
        pass

    inert = SimpleNamespace(close=close)
    model_intents = IntegrationIntentClient(
        service="models", credential=credentials["models"], transport=mesh
    )
    integration_intents = IntegrationIntentClient(
        service="integrations", credential=credentials["integrations"], transport=mesh
    )

    def settings(service):
        return Settings(
            _config_file=None,
            _read_environment=False,
            fpl_database_path=str(root / service / "service.db"),
            fpl_secrets_key=Fernet.generate_key().decode(),
        )

    model_settings, integration_settings = settings("models"), settings("integrations")
    apply(model_settings.database_path, "models", MODEL_MIGRATIONS)
    apply(integration_settings.database_path, "integrations", INTEGRATION_MIGRATIONS)
    model = models_app(
        settings=model_settings,
        catalog=catalog,
        public_key=key.public_key(),
        identity=LiveAuthorization(
            service="models", credential=credentials["models"], transport=mesh
        ),
        capabilities=CapabilityClient(
            service="models", credential=credentials["models"], catalog=catalog, transport=mesh
        ),
        events=inert,
        directory=inert,
        audit=ModelAuditClient(credential=credentials["models"], transport=mesh),
        integration_intents=model_intents,
        demo_install_client=DemoInstallClient(model_intents, transport=mesh),
        run_tasks=False,
    )
    integration = integrations_app(
        settings=integration_settings,
        catalog=catalog,
        public_key=key.public_key(),
        identity=LiveAuthorization(
            service="integrations", credential=credentials["integrations"], transport=mesh
        ),
        intents=integration_intents,
        capacity=ValidationCapacityClient(integration_intents, transport=mesh),
        run_tasks=False,
    )
    mesh.apps.update(models=model, integrations=integration)
    async with AsyncExitStack() as stack:
        for app in (identity, model, integration):
            await stack.enter_async_context(app.router.lifespan_context(app))
        async with identity.state.database.sessions() as session:
            user, _ = await create_account(
                session,
                username="demo-owner",
                display_name="Demo Owner",
                password="Synthetic-Demo-Password!",
                platform_role="admin",
            )
            owner = user.id
        async with model.state.database.sessions(info={"owner_user_id": owner}) as session:
            await initialize_account_catalog(session, owner, "admin")
            await session.commit()
        async with (
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=identity),
                base_url="http://127.0.0.1:19000",
                headers={"X-Fpl-Gateway": "studio-demo-fixture-" * 3, "X-Fpl-Ingress": "local"},
            ) as studio,
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=identity),
                base_url="http://127.0.0.1:19002",
                headers={"X-Fpl-Gateway": "management-demo-fixture-" * 3, "X-Fpl-Ingress": "local"},
            ) as management,
            httpx.AsyncClient(transport=mesh) as client,
        ):
            for browser in (studio, management):
                login = await browser.post(
                    "/v1/auth/login",
                    json={"username": "demo-owner", "password": "Synthetic-Demo-Password!"},
                )
                assert login.status_code == 200, login.text

            async def call(service, method, path, *, manager=False, **kwargs):
                browser = management if manager else studio
                origin = "http://127.0.0.1:19002" if manager else "http://127.0.0.1:19000"
                cookie = "fpl_management_csrf" if manager else "fpl_csrf"
                authorized = await browser.get(
                    "/_internal/v1/authorize",
                    headers={
                        "Origin": origin,
                        "X-CSRF-Token": browser.cookies.get(cookie),
                        "X-Fpl-Target-Service": service,
                        "X-Fpl-Request-Method": method,
                        "X-Fpl-Request-Uri": path,
                    },
                )
                assert authorized.status_code == 204, authorized.text
                return await client.request(
                    method,
                    f"http://{service}:8080" + path,
                    headers={HEADER: authorized.headers[HEADER]},
                    **kwargs,
                )

            action = await call(
                "models",
                "POST",
                "/v1/platform/demo-services/example_tools/actions",
                manager=True,
                json={"action": "start", "expected_revision": 0},
            )
            assert action.status_code == 200, action.text
            catalogue = await call("models", "GET", "/v1/model-providers")
            assert catalogue.status_code == 200
            catalog_revision = catalogue.json()["revision"]
            install_path = "/v1/account/demo-services/example_tools/install"
            uncertain = await call(
                "models", "POST", install_path, json={"expected_catalog_revision": catalog_revision}
            )
            assert uncertain.status_code == 503, uncertain.text
            async with integration.state.database.sessions(
                info={"owner_user_id": owner}
            ) as session:
                assert len(list(await session.scalars(select(ToolApiIntegration)))) == 3
            # An interrupted caller continues from the committed receipt, without creating again.
            await model.state.demo_installations.process_once()
            replay = await call(
                "models", "POST", install_path, json={"expected_catalog_revision": catalog_revision}
            )
            assert replay.status_code == 200, replay.text
            tools = await call("integrations", "GET", "/v1/integrations/tool-apis")
            assert tools.status_code == 200, tools.text
            items = tools.json()["items"]
            assert len(items) == 3
            product = next(row for row in items if row["url"].endswith("/products"))
            checked = await call(
                "integrations",
                "POST",
                f"/v1/integrations/tool-apis/{product['id']}/validate",
                json={"input": {"q": "耳机"}},
            )
            assert checked.status_code == 200, checked.text
            assert checked.json()["check"]["ok"], checked.text
            result = json.loads(checked.json()["response_preview"])
            assert result["demo"] and len(result["items"]) == 1
            async with model.state.database.sessions(info={"owner_user_id": owner}) as session:
                leases = list(await session.scalars(select(RuntimeAdmission)))
                assert len(leases) == 1 and leases[0].released_at is not None
            async with integration.state.database.sessions(
                info={"owner_user_id": owner}
            ) as session:
                assert len(list(await session.scalars(select(DemoToolInstallation)))) == 1
            await next(
                r
                for r in model.state.runner_supervisor.runners
                if isinstance(r, ModelAuditDelivery)
            ).process_once()
            async with identity.state.database.sessions() as session:
                events = list(
                    await session.scalars(
                        select(SecurityAuditEvent).where(
                            SecurityAuditEvent.event_type == "demo_service.installed"
                        )
                    )
                )
                assert len(events) == 1


if __name__ == "__main__":
    asyncio.run(main())
