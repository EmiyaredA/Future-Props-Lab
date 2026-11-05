"""Verify signed connection operations and durable Mac worker acknowledgements."""

import asyncio
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from tests.test_community_asset_protocol import CATALOG, PASSWORD, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from app.capabilities.agents.cli.contracts import AgentOut, CatalogOut
from app.capabilities.agents.cli.definitions import DEFINITIONS
from app.runtime.time import utc_now
from fpl_agent_runtime.application import create_app
from fpl_agent_runtime.migrations.registry import MIGRATIONS
from fpl_agent_runtime.models import ConnectionJob
from fpl_agent_runtime.review_http import NATIVE
from fpl_host.agent_connections_worker import ConnectionWorker
from fpl_host.transport import NativeTransport
from fpl_identity.accounts import create_account
from fpl_runtime.agent_connections import DETECT, PREFIX, ConnectionOptions
from fpl_runtime.claims import HEADER, issue_context, verify_context
from fpl_runtime.migrations import apply

ROOT = Path(__file__).resolve().parents[1]
SERVICE = "agent-runtime"
ENABLE = f"{PREFIX}/codex/enable"
TOKEN = "worker-agent-runtime-test-" * 3
INGRESS = "ingress-agent-runtime-test-" * 3
IDENTITY_TOKEN = "identity-agent-runtime-test-" * 3


class NativeBridge(httpx.AsyncBaseTransport):
    def __init__(self, app):
        self.upstream = httpx.ASGITransport(app=app)
        self.lose_next_receipt = False

    async def handle_async_request(self, request):
        request.url = request.url.copy_with(path=request.url.path.removeprefix(f"/{SERVICE}"))
        request.headers["X-Fpl-Native-Ingress"] = INGRESS
        response = await self.upstream.handle_async_request(request)
        if self.lose_next_receipt and request.url.path.endswith("/receipt"):
            self.lose_next_receipt = False
            assert response.status_code == 200
            await response.aclose()
            return httpx.Response(503)
        return response


async def test_cli_worker_live_admission_and_lost_receipt(scenario, tmp_path):  # noqa: F811
    case = scenario
    state = tmp_path / "runtime"
    apply(state / "service.db", SERVICE, MIGRATIONS)
    case.identity.state.identity_options["service_credentials"][SERVICE] = IDENTITY_TOKEN
    app = create_app(
        state_root=state,
        public_key=case.key.public_key(),
        catalog=CATALOG,
        transport=case.mesh,
        options=ConnectionOptions(
            identity_credential=IDENTITY_TOKEN, ingress=INGRESS, workers={"mac": TOKEN}
        ),
        schema_path=ROOT / "web/src/generated/openapi.json",
    )
    prior_owner, legacy_queued, legacy_leased = (str(uuid4()) for _ in range(3))
    async with app.state.database.sessions(info={"owner_user_id": prior_owner}) as session:
        session.add_all(
            [
                ConnectionJob(
                    id=identity,
                    owner_user_id=prior_owner,
                    operation=DETECT,
                    request_id=str(uuid4()),
                    payload_sha256="0" * 64,
                    payload={
                        "input": {"show_paths": True},
                        "deadline": utc_now().isoformat(),
                        "assertion": "retired-fixture-assertion",
                    },
                    status=status,
                )
                for identity, status in ((legacy_queued, "queued"), (legacy_leased, "leased"))
            ]
        )
        await session.commit()
    bridge = NativeBridge(app)
    transport = NativeTransport(
        service=SERVICE,
        base_url=f"http://127.0.0.1:19091/{SERVICE}",
        credential=TOKEN,
        transport=bridge,
    )
    enabled = []

    async def catalog(*, can_enable):
        return CatalogOut(
            items=[
                AgentOut(
                    id=definition.id,
                    name=definition.name,
                    executable=f"/fixture/{definition.binary}" if can_enable else "",
                    version="2.163.300",
                    enabled=True,
                    available=True,
                    status="ready",
                    message="fixture",
                )
                for definition in DEFINITIONS.values()
            ]
        )

    async def enable(agent_id, *, before_publish):
        await before_publish()
        enabled.append(agent_id)

    worker = ConnectionWorker(transport, tmp_path / "host", catalog=catalog, enable=enable)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://runtime") as api,
    ):
        assert (await api.get(PREFIX)).status_code == 401
        assert (await api.get("/ready")).status_code == 503
        denied_worker = await api.post(
            "/_native/v1/claim",
            json={"wait_seconds": 0},
            headers={"Authorization": f"Bearer {TOKEN}", "Origin": "http://browser"},
        )
        assert denied_worker.status_code == 403
        async with app.state.database.sessions(info={"owner_user_id": prior_owner}) as session:
            old_queued = await session.get(ConnectionJob, legacy_queued)
            old_leased = await session.get(ConnectionJob, legacy_leased)
            assert (old_queued.status, old_leased.status) == ("failed", "unknown")
            assert all("assertion" not in row.payload for row in (old_queued, old_leased))
        assert await transport.post("claim", {"wait_seconds": 0}) == {"lease": None}
        assert (await api.get("/ready")).status_code == 503
        assert await transport.post(NATIVE.removeprefix("/_native/v1/") + "/claim", {}) == {
            "lease": None
        }
        assert (await api.get("/ready")).json() == {"status": "ok", "service": SERVICE}
        app.state.visual_reviews.last_poll -= 91
        assert (await api.get("/ready")).status_code == 503
        user = await authorize(case, SERVICE, "POST", ENABLE)
        denied = await api.post(ENABLE, headers=user)
        assert denied.status_code == 403
        assert denied.json()["code"] == "platform_admin_required"

        async with case.identity.state.database.sessions() as session:
            await create_account(
                session,
                username="agent-admin",
                display_name="Agent Admin",
                password=PASSWORD,
                platform_role="admin",
            )
        logged = await case.browser.post(
            "/v1/auth/login", json={"username": "agent-admin", "password": PASSWORD}
        )
        assert logged.status_code == 200
        case.csrf = case.browser.cookies["fpl_csrf"]
        local = await authorize(case, SERVICE, "GET", PREFIX)
        read = asyncio.create_task(api.get(PREFIX, headers=local))
        await worker.poll_once()
        visible = (await asyncio.wait_for(read, 5)).json()
        assert visible["can_enable"] is True and visible["items"][0]["executable"]

        actor = verify_context(
            local[HEADER],
            service=SERVICE,
            method="GET",
            path=PREFIX,
            public_key=case.key.public_key(),
        )
        public = issue_context(
            replace(actor, local=False),
            service=SERVICE,
            method="GET",
            path=PREFIX,
            private_key=case.key,
            key_id="isolated",
        )
        read = asyncio.create_task(api.get(PREFIX, headers={HEADER: public}))
        await worker.poll_once()
        hidden = (await asyncio.wait_for(read, 5)).json()
        assert hidden["can_enable"] is False
        assert not any(item["executable"] for item in hidden["items"])

        headers = await authorize(case, SERVICE, "POST", ENABLE)
        bridge.lose_next_receipt = True
        request = asyncio.create_task(api.post(ENABLE, headers=headers))
        with pytest.raises(httpx.HTTPStatusError):
            await worker.poll_once()
        assert (await asyncio.wait_for(request, 5)).status_code == 204
        assert len(list(worker.receipts.pending())) == 1
        await worker.poll_once()
        assert not list(worker.receipts.pending())
        assert enabled == ["codex"]

        original_status = app.state.connections.identity.status
        count = 0

        async def revoked_before_publish(**kwargs):
            nonlocal count
            count += 1
            return False if count >= 3 else await original_status(**kwargs)

        app.state.connections.identity.status = revoked_before_publish
        headers = await authorize(case, SERVICE, "POST", ENABLE)
        request = asyncio.create_task(api.post(ENABLE, headers=headers))
        await worker.poll_once()
        assert (await asyncio.wait_for(request, 5)).status_code == 403
        assert enabled == ["codex"]
    await transport.close()
