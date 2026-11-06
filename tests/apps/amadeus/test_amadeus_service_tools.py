"""Real Identity intents and owned Integrations execute only exact approved tool calls."""

import json

import httpx
from cryptography.fernet import Fernet

from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS as AMADEUS_MIGRATIONS
from studio.apps.integrations.clients.authority import IntegrationIntentClient
from studio.apps.integrations.storage.migrations.registry import (
    MIGRATIONS as INTEGRATION_MIGRATIONS,
)
from studio.assembly.independent.amadeus.application import create_app as create_amadeus
from studio.assembly.independent.integrations.application import create_app as create_integrations
from studio.config.settings import Settings
from studio.contracts.integrations.integration_intents import TOOL_CALL_PATH
from studio.runtime.database.migrations import apply
from tests.apps.integrations.test_integrations_application import Ports
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize


class ToolMesh(httpx.AsyncBaseTransport):
    def __init__(self, mesh):
        self.mesh = mesh
        self.lose = False
        self.latest = None

    async def handle_async_request(self, request):
        response = await self.mesh.handle_async_request(request)
        if request.url.path.startswith(TOOL_CALL_PATH):
            self.latest = request
            if self.lose:
                self.lose = False
                assert response.status_code == 200
                await response.aclose()
                raise httpx.ReadError("isolated lost tool receipt", request=request)
        return response


async def test_approved_tools_have_bound_inputs_and_repeatable_integration_receipts(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    amadeus_root, integration_root = tmp_path / "amadeus", tmp_path / "integrations"
    for service, root, migrations in (
        ("amadeus", amadeus_root, AMADEUS_MIGRATIONS),
        ("integrations", integration_root, INTEGRATION_MIGRATIONS),
    ):
        root.mkdir()
        apply(root / "service.db", service, migrations)
    tokens = {
        service: "isolated-tool-call-" + service * 4 for service in ("amadeus", "integrations")
    }
    case.identity.state.identity_options["service_credentials"].update(tokens)
    settings = Settings(
        _config_file=None,
        fpl_database_path=str(integration_root / "service.db"),
        fpl_secrets_key=Fernet.generate_key().decode(),
    )
    mesh = ToolMesh(case.mesh)
    calls = []

    async def demo(tool, inputs):
        calls.append((tool, inputs))
        return {"tool": tool, "input": inputs}

    port = Ports()
    integrations = create_integrations(
        settings=settings,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        identity=port,
        intents=IntegrationIntentClient(
            service="integrations", credential=tokens["integrations"], transport=case.mesh
        ),
        capacity=port,
        mcp_client=port,
        demo_tools=demo,
        run_tasks=False,
    )
    case.mesh.apps["integrations"] = integrations
    amadeus = create_amadeus(
        state_root=amadeus_root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=tokens["amadeus"],
        transport=mesh,
    )
    async with (
        integrations.router.lifespan_context(integrations),
        amadeus.router.lifespan_context(amadeus),
        httpx.AsyncClient(transport=case.mesh, base_url="http://integrations") as integration_api,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=amadeus), base_url="http://amadeus"
        ) as api,
    ):
        endpoint = "/v1/integrations/tool-apis"
        configured = await integration_api.post(
            endpoint,
            headers=await authorize(case, "integrations", "POST", endpoint),
            json={"name": "Owned tool", "url": "https://fpl-tools.invalid/orders"},
        )
        assert configured.status_code == 201, configured.text
        tool = configured.json()

        async def send(path, **kwargs):
            return await api.post(
                path, headers=await authorize(case, "amadeus", "POST", path), **kwargs
            )

        base = "/v1/amadeus/conversations"
        conversation = (await send(base)).json()["id"]
        proposed = await send(
            f"{base}/{conversation}/actions",
            json={
                "tool_name": "tool_api:" + tool["id"],
                "arguments": {"revision": tool["revision"], "input": {"number": 7}},
            },
        )
        assert proposed.status_code == 200, proposed.text
        record = proposed.json()
        action = f"{base}/{conversation}/actions/{record['id']}"
        approved = await send(
            action + "/decision",
            json={"approve": True, "arguments_sha256": record["arguments_sha256"]},
        )
        assert approved.status_code == 200, approved.text
        mesh.lose = True
        streamed = await send(action + "/execute/stream")
        assert streamed.json()["type"] == "end", streamed.text
        assert streamed.json()["action"]["status"] == "unknown", streamed.text
        assert calls == [("orders", {"number": 7})]
        assert (await send(action + "/execute")).status_code == 409
        request = mesh.latest
        assert request is not None
        assert (
            await integration_api.post(request.url.path, json={"inputs": {"number": 7}})
        ).status_code == 401
        headers = {"X-Fpl-Context": request.headers["X-Fpl-Context"]}
        denied = await integration_api.post(
            request.url.path, headers=headers, json={"inputs": {"number": 8}}
        )
        assert denied.status_code == 403, denied.text
        replayed = await integration_api.post(
            request.url.path, headers=headers, json={"inputs": {"number": 7}}
        )
        assert replayed.json()["status"] == "completed", replayed.text
        assert json.loads(replayed.json()["result"]["text"]) == {
            "tool": "orders",
            "input": {"number": 7},
        }
        assert calls == [("orders", {"number": 7})]
