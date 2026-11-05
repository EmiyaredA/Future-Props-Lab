"""Exercise owned CLI dialogue tools, approval, continuation and cancellation."""

import asyncio

import httpx
from tests.test_amadeus_service_native import CREDENTIAL, INGRESS, WORKER, MacBridge
from tests.test_community_asset_protocol import CATALOG, scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize

from app.console.amadeus.tool_contracts import SCHEMAS
from app.runtime.operation_receipts import OperationError
from fpl_amadeus.application import create_app
from fpl_amadeus.migrations.registry import MIGRATIONS
from fpl_host.amadeus_dialogue import DialogueWorker
from fpl_host.amadeus_worker import AmadeusWorker
from fpl_host.transport import NativeTransport
from fpl_runtime.migrations import apply
from fpl_runtime.native_ingress import NativeWorkerOptions


class Connections:
    def __init__(self, runtime_root):
        self.runtime_root = runtime_root

    def available(self):
        return {"codex": "1" * 64}

    async def resolve(self, scope, *, probe):
        assert scope.agent == "codex" and scope.signature == self.available()["codex"]
        return "sealed-codex-fixture" if probe else ""


async def test_amadeus_cli_owner_tools_pause_continue_and_stop(
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
    bridge = MacBridge(app)
    bridge.lose_receipt = False
    transport = NativeTransport(
        service="amadeus",
        base_url="http://127.0.0.1:29090/amadeus",
        credential=WORKER,
        transport=bridge,
    )
    connections = Connections(tmp_path / "agent-profiles")
    provider_started, provider_stopped = asyncio.Event(), asyncio.Event()

    async def runner(agent, executable, model, prompt, tools, call, emit, *, root, runtime_path):
        assert (agent, executable, model) == ("codex", "sealed-codex-fixture", "")
        assert runtime_path == connections.runtime_root and root.is_dir()
        assert {item["name"] for item in tools} == set(SCHEMAS)
        if "block-fixture" in prompt:
            provider_started.set()
            try:
                await asyncio.Event().wait()
            finally:
                provider_stopped.set()
        if "Approved by owner" in prompt:
            await emit("assistant_delta", {"text": "Read the approved result."})
            return

        await emit("assistant_delta", {"text": "Preparing an owned file."})
        operations = await call("operations", {"resource": "files"})
        assert any(item["id"] == "files.list_files" for item in operations["items"])
        read = await call("call", {"operation": "files.list_files", "arguments": {}})
        assert read["status_code"] == 200 and case.asset not in str(read)
        try:
            await call("shell", {"command": "test"})
        except OperationError:
            pass
        else:
            raise AssertionError("unregistered tool should be denied")
        await call("write_file", {"name": "reviewed.txt", "content": "Approved by owner"})

    worker = AmadeusWorker(
        transport,
        root,
        tmp_path / "worker",
        probe=lambda: False,
        connections=connections,
        dialogue=DialogueWorker(transport, root, connections, runner=runner),
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://amadeus") as api,
    ):
        assert (await api.get("/ready")).status_code == 503
        await worker.poll_once()
        assert (await api.get("/ready")).status_code == 200

        async def send(method, path, **kwargs):
            return await api.request(
                method, path, headers=await authorize(case, "amadeus", method, path), **kwargs
            )

        conversations = "/v1/amadeus/conversations"
        created = await send("POST", conversations)
        path = conversations + "/" + created.json()["id"]
        runs = path + "/runs"
        started = await send("POST", runs, json={"agent_id": "codex"})
        assert started.status_code == 200, started.text
        run = started.json()["run"]
        assert "executable" not in run["execution_config"]
        assert (
            run["execution_config"]["agent_connection_signature"]
            == connections.available()["codex"]
        )
        await worker.poll_once()
        state = await send("GET", runs + "/" + run["id"])
        assert state.json()["run"]["status"] == "waiting_approval", state.text
        assert state.json()["run"]["partial_text"] == "Preparing an owned file."
        conversation = await send("GET", path)
        proposal = conversation.json()["actions"][0]
        action = path + "/actions/" + proposal["id"]
        approved = await send(
            "POST",
            action + "/decision",
            json={"arguments_sha256": proposal["arguments_sha256"], "approve": True},
        )
        assert approved.status_code == 200, approved.text
        executed = await send("POST", action + "/execute")
        assert executed.json()["status"] == "completed", executed.text
        work = await send("GET", path + "/files/outputs/reviewed.txt")
        assert work.content == b"Approved by owner"

        continued = await send("POST", runs, json={"agent_id": "codex", "source_run_id": run["id"]})
        assert continued.status_code == 200, continued.text
        await worker.poll_once()
        second = runs + "/" + continued.json()["run"]["id"]
        async with asyncio.timeout(2):
            while True:
                completed = await send("GET", second)
                if completed.json()["run"]["status"] != "running":
                    break
                await asyncio.sleep(0.02)
        assert completed.json()["run"]["status"] == "completed", completed.text
        assert completed.json()["run"]["partial_text"] == "Read the approved result."

        blocked = await send(
            "POST", runs, json={"agent_id": "codex", "context": [{"key": "block-fixture"}]}
        )
        assert blocked.status_code == 200, blocked.text
        executing = asyncio.create_task(worker.poll_once())
        async with asyncio.timeout(3):
            await provider_started.wait()
            stopped = await send("POST", runs + "/" + blocked.json()["run"]["id"] + "/cancel")
            assert stopped.json()["run"]["status"] == "cancelled", stopped.text
            await provider_stopped.wait()
            await executing
    await transport.close()
