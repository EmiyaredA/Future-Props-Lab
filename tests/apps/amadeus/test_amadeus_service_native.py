"""Check that Amadeus Finder requests retain only scoped Mac action receipts."""

import asyncio
import hashlib
import json
from dataclasses import replace

import httpx
import pytest
from sqlalchemy import select

from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.apps.amadeus.storage.service_models import AmadeusNativeJob
from studio.assembly.independent.amadeus.application import create_app
from studio.contracts.agent_workbench.native import NativeLease
from studio.contracts.identity.claims import HEADER, issue_context, verify_context
from studio.host.agent_execution.amadeus_worker import AmadeusWorker
from studio.host.transport import NativeTransport
from studio.runtime.database.migrations import apply
from studio.runtime.http.native_ingress import NativeWorkerOptions
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize

CONVERSATIONS = "/v1/amadeus/conversations"
CREDENTIAL = "isolated-amadeus-service-token-" * 2
INGRESS = "isolated-amadeus-ingress-token-" * 2
WORKER = "isolated-amadeus-mac-token-" * 2


class MacBridge(httpx.AsyncBaseTransport):
    def __init__(self, app):
        self.transport = httpx.ASGITransport(app=app)
        self.lose_receipt = True

    async def handle_async_request(self, request):
        request.url = request.url.copy_with(path=request.url.path.removeprefix("/amadeus"))
        request.headers["X-Fpl-Native-Ingress"] = INGRESS
        reply = await self.transport.handle_async_request(request)
        if self.lose_receipt and request.url.path.endswith("/receipt"):
            self.lose_receipt = False
            await reply.aclose()
            raise httpx.ReadError("isolated lost receipt acknowledgement", request=request)
        return reply


async def wait_for_intent(app):
    async with asyncio.timeout(2):
        while not app.state.native_host.requests:
            await asyncio.sleep(0.01)


async def test_finder_live_scope_receipt_replay_and_sandbox_probe(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    root = tmp_path / "amadeus"
    root.mkdir()
    apply(root / "service.db", "amadeus", MIGRATIONS)
    case.identity.state.identity_options["service_credentials"]["amadeus"] = CREDENTIAL
    app = create_app(
        state_root=root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=CREDENTIAL,
        transport=case.mesh,
        native_options=NativeWorkerOptions(
            ingress=INGRESS, identity_credential=CREDENTIAL, workers={"mac": WORKER}
        ),
    )
    transport = NativeTransport(
        service="amadeus",
        base_url="http://127.0.0.1:29090/amadeus",
        credential=WORKER,
        transport=MacBridge(app),
    )
    opened = []

    async def script(owner, conversation, arguments, emit, *, files_root):
        assert owner == case.viewer and files_root == root
        assert arguments["sha256"] == hashlib.sha256(arguments["command"].encode()).hexdigest()
        assert conversation == identity
        await emit("isolated ")
        await emit("script output")
        return {"exit_code": 0, "output": "isolated script output", "truncated": False}

    worker = AmadeusWorker(
        transport,
        root,
        tmp_path / "mac",
        launch=lambda command, **_: opened.append(command),
        probe=lambda: True,
        script=script,
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://amadeus") as api,
    ):
        created = await api.post(
            CONVERSATIONS, headers=await authorize(case, "amadeus", "POST", CONVERSATIONS)
        )
        assert created.status_code == 200, created.text
        identity = created.json()["id"]
        path = f"{CONVERSATIONS}/{identity}/files/open-folder"
        proof = await authorize(case, "amadeus", "POST", path)
        actor = verify_context(
            proof[HEADER],
            service="amadeus",
            method="POST",
            path=path,
            public_key=case.key.public_key(),
        )
        public_proof = issue_context(
            replace(actor, local=False),
            service="amadeus",
            method="POST",
            path=path,
            private_key=case.key,
            key_id="test",
        )
        assert (await api.post(path, headers={HEADER: public_proof})).status_code == 403
        probe = "/v1/amadeus/script-capability"
        probe_proof = await authorize(case, "amadeus", "GET", probe)
        assert (await api.get(probe, headers=probe_proof)).json() == {"available": False}
        assert (await api.post(path, headers=proof)).status_code == 503
        assert (
            await api.post("/_native/v1/claim", json={"sandbox_available": True})
        ).status_code == 403
        await transport.post("claim", {"wait_seconds": 0, "sandbox_available": True})
        assert (await api.get(probe, headers=probe_proof)).json() == {"available": True}

        opening = asyncio.create_task(api.post(path, headers=proof))
        await wait_for_intent(app)
        with pytest.raises(httpx.ReadError):
            await worker.poll_once()
        assert (await opening).json() == {"opened": True}
        await worker.poll_once()
        assert opened == [
            ["/usr/bin/open", str(root / "accounts" / case.viewer / "amadeus" / identity)]
        ]
        async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
            row = await session.scalar(select(AmadeusNativeJob))
            assert row.payload == {"conversation_id": identity}
            assert row.result == {"opened": True} and row.status == "completed"

        command = "printf 'isolated script output'"
        endpoint = f"{CONVERSATIONS}/{identity}/actions"
        proposed = await api.post(
            endpoint,
            headers=await authorize(case, "amadeus", "POST", endpoint),
            json={
                "tool_name": "run_script",
                "arguments": {
                    "kind": "shell",
                    "command": command,
                    "sha256": hashlib.sha256(command.encode()).hexdigest(),
                },
            },
        )
        assert proposed.status_code == 200, proposed.text
        action = endpoint + "/" + proposed.json()["id"]
        decision = action + "/decision"
        approved = await api.post(
            decision,
            headers=await authorize(case, "amadeus", "POST", decision),
            json={"arguments_sha256": proposed.json()["arguments_sha256"], "approve": True},
        )
        assert approved.status_code == 200, approved.text
        execute = action + "/execute/stream"
        executing = asyncio.create_task(
            api.post(execute, headers=await authorize(case, "amadeus", "POST", execute))
        )
        await wait_for_intent(app)
        await worker.poll_once()
        response = await executing
        events = [json.loads(line) for line in response.text.splitlines()]
        assert "".join(item["text"] for item in events[:-1]) == "isolated script output"
        assert events[-1]["action"]["result"]["exit_code"] == 0
        assert events[-1]["action"]["status"] == "completed"

        opening = asyncio.create_task(api.post(path, headers=proof))
        await wait_for_intent(app)
        claimed = await transport.post("claim", {"wait_seconds": 1, "sandbox_available": True})
        lease = NativeLease.model_validate(claimed["lease"])
        logout = await case.browser.post(
            "/v1/auth/logout",
            headers={"X-CSRF-Token": case.csrf, "Origin": "http://127.0.0.1:19000"},
        )
        assert logout.status_code == 204
        denied = await worker.receipts.execute_async(lease, worker.execute)
        assert denied.status == "failed" and denied.error_code == "authorization_revoked"
        await worker.deliver(lease, denied)
        assert (await opening).status_code == 403
        assert len(opened) == 1
    await transport.close()
