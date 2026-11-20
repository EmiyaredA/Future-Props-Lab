"""The browser, owned service and Mac worker deliver references during a live run."""

import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, Request, Response

from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.amadeus.application import create_app
from studio.contracts.identity.claims import HEADER, verify_context
from studio.host.agent_execution.amadeus_dialogue import DialogueWorker
from studio.host.agent_execution.amadeus_worker import AmadeusWorker
from studio.host.transport import NativeTransport
from studio.runtime.database.migrations import apply
from studio.runtime.http.native_ingress import NativeWorkerOptions
from tests.apps.amadeus.test_amadeus_service_native import CREDENTIAL, INGRESS, WORKER, MacBridge
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize


@pytest.mark.parametrize("agent", ["codex", "claude-code", "opencode", "dsh", "pi"])
async def test_native_delivery_keeps_run_and_imports_file_while_running(scenario, tmp_path, agent):  # noqa: F811
    case = scenario
    visual = FastAPI()

    @visual.get("/v1/visual-workshop/projects/{project_id}")
    async def project(project_id: str, request: Request):
        actor = verify_context(
            request.headers[HEADER],
            service="visual",
            method="GET",
            path=request.url.path,
            public_key=case.key.public_key(),
        )
        assert actor.user_id == case.viewer
        return Response("{}", status_code=200 if project_id == "owned" else 404)

    case.mesh.apps["visual"] = visual
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
            ingress=INGRESS,
            identity_credential=CREDENTIAL,
            workers={"mac": WORKER},
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

    class Connections:
        runtime_root = tmp_path / "profiles"

        def available(self):
            return {agent: "1" * 64}

        async def resolve(self, scope, *, probe):
            assert isinstance(probe, bool)
            assert scope.signature == self.available()[agent]
            assert scope.agent == agent
            return "isolated-cli"

    stop = asyncio.Event()
    received = []

    async def runner(
        _agent, _executable, _model, _prompt, _tools, call, emit, *, instructions, **_options
    ):
        async def steer(identity, prompt):
            payload = json.loads(prompt.split("\n", 1)[1])
            received.append(payload)
            file = payload["references"][0]
            value = await call("read_file", {"kind": "imports", "name": file["name"]})
            assert value == {"content": "new evidence"}
            instructions.acknowledge(identity, "accepted")
            await emit("assistant_delta", {"text": "补充已读取"})

        instructions.send = steer
        await emit("assistant_delta", {"text": "原回复"})
        await stop.wait()

    connections = Connections()
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

        async def send(method, path, **kwargs):
            return await api.request(
                method, path, headers=await authorize(case, "amadeus", method, path), **kwargs
            )

        await worker.poll_once()
        created = await send("POST", "/v1/amadeus/conversations")
        path = "/v1/amadeus/conversations/" + created.json()["id"]
        started = await send("POST", path + "/runs", json={"agent_id": agent})
        run_path = path + "/runs/" + started.json()["run"]["id"]
        executing = asyncio.create_task(worker.poll_once())
        async with asyncio.timeout(5):
            while not (await send("GET", run_path)).json()["can_receive"]:
                await asyncio.sleep(0.03)
            upload = await send(
                "POST",
                path + "/imports",
                files={"upload": ("new.txt", b"new evidence", "text/plain")},
            )
            assert upload.status_code == 200, upload.text
            name = upload.json()["name"]
            request = {
                "request_id": str(uuid4()),
                "expected_revision": 0,
                "text": "参考新附件",
                "references": [
                    {
                        "id": f"file:{name}",
                        "source": "imports",
                        "name": name,
                        "application": "会话文件",
                    }
                ],
            }
            reference = {
                "id": "node",
                "application": "视觉创作",
                "name": "节点",
                "target": {
                    "project_resource": "visual",
                    "project_id": "owned",
                    "element_kind": "node",
                    "element_id": "node",
                },
            }
            denied = await send(
                "POST",
                run_path + "/instructions",
                json={
                    **request,
                    "references": [
                        {**reference, "target": {**reference["target"], "project_id": "other"}}
                    ],
                },
            )
            assert denied.status_code == 403, denied.text
            assert not (await send("GET", run_path)).json()["instructions"]
            request["references"].append(reference)
            inserted = await send("POST", run_path + "/instructions", json=request)
            assert inserted.status_code == 200, inserted.text
            replay = await send("POST", run_path + "/instructions", json=request)
            assert replay.json()["message_id"] == inserted.json()["message_id"]
            while True:
                detail = (await send("GET", run_path)).json()
                if detail["instructions"][0]["status"] == "accepted":
                    break
                await asyncio.sleep(0.03)
            assert len(received) == 1
            assert received[0]["references"][1]["target"]["project_id"] == "owned"
            history = (await send("GET", path)).json()
            assert history["conversation"]["revision"] == 1
            assert history["messages"][0]["references"][0]["name"] == name
            stop.set()
            await executing
            while (await send("GET", run_path)).json()["run"]["status"] == "running":
                await asyncio.sleep(0.03)
            final = (await send("GET", run_path)).json()
            assert final["run"]["partial_text"] == "原回复补充已读取"
            assert final["instructions"][0]["status"] == "accepted"
            assert not final["can_receive"]
    await transport.close()
