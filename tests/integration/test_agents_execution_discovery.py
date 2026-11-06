"""Verify separate Mac discovery credentials, cloud authority, and owned project selection."""

import asyncio
import json
from time import time
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from studio.apps.agent_workbench.execution import project_files, project_paths, projects
from studio.apps.agent_workbench.storage.migrations.registry import MIGRATIONS
from studio.apps.agent_workbench.storage.models import WorkbenchSession
from studio.apps.agent_workbench.storage.service_models import WorkbenchExecutionJob
from studio.assembly.independent.agent_workbench.application import create_app
from studio.config.settings import get_settings
from studio.contracts.agent_workbench.execution import (
    CATALOG_PATH,
    CHATS_PATH,
    DIRECTORY_PATH,
    PREVIEW_SOURCE,
    PROJECT_PATH,
    decision_path,
    history_source_path,
    instruction_path,
    queue_remove_path,
    queue_resume_path,
    source_path,
    turn_path,
)
from studio.contracts.identity.claims import HEADER, Actor, issue_context, verify_context
from studio.contracts.identity.cloud_authority import CloudAuthority, permits_cloud_authority
from studio.contracts.identity.permissions import role_scopes
from studio.host.agent_execution.workbench_worker import WorkbenchConfiguration, WorkbenchWorker
from studio.host.transport import NativeTransport
from studio.runtime.database.migrations import apply
from tests.apps.agent_workbench.archive_database import archive_catalog

INGRESS = "isolated-workbench-ingress-" * 2
COLLECTOR = "isolated-workbench-collector-" * 2
EXECUTOR = "isolated-workbench-executor-" * 2


class Identity:
    def __init__(self, key):
        self.key = key
        self.revoked = False
        self.unlocked_until = 0

    async def cloud_authority(self, *, assertion, method, path):
        assert permits_cloud_authority("agents", method, path)
        actor = verify_context(
            assertion, service="agents", method=method, path=path, public_key=self.key
        )
        allowed = actor.platform_role == "admin" and not self.revoked
        return CloudAuthority(active=allowed, enabled=allowed, unlocked_until=self.unlocked_until)

    async def close(self):
        pass


class Bridge(httpx.AsyncBaseTransport):
    def __init__(self, app):
        self.transport = httpx.ASGITransport(app=app)

    async def handle_async_request(self, request):
        request.url = request.url.copy_with(path=request.url.path.removeprefix("/agents"))
        request.headers["X-Fpl-Native-Ingress"] = INGRESS
        return await self.transport.handle_async_request(request)


async def test_native_workbench_project_discovery_keeps_roots_local(tmp_path, monkeypatch):
    owner, other = str(uuid4()), str(uuid4())
    key = Ed25519PrivateKey.generate()
    catalog = archive_catalog(monkeypatch)
    service = tmp_path / "service"
    work = tmp_path / "projects" / "Owned"
    profiles = tmp_path / "agent-runtime"
    for path in (service, work, profiles):
        path.mkdir(parents=True)
    config = tmp_path / "workbench.toml"
    configured_project = (
        '[cloud_control.projects.fixture]\nlabel = "Public authorized fixture"\n'
        + f"root = {json.dumps(str(work))}\nuser_ids = [{json.dumps(owner)}]\n"
    )
    config.write_text(configured_project)
    monkeypatch.setenv("FPL_DATABASE_PATH", str(service / "service.db"))
    get_settings.cache_clear()
    monkeypatch.setattr(projects, "anchors", lambda: {work.parent: "Fixture projects"})
    monkeypatch.setattr(projects, "suggestions", lambda _settings: [])
    # Pytest's retained evidence runs under the repository's hidden .local directory.
    visible = project_paths.visible
    monkeypatch.setattr(project_paths, "visible", lambda name: name == ".local" or visible(name))
    apply(service / "service.db", "agents", MIGRATIONS)
    identity = Identity(key.public_key())
    app = create_app(
        state_root=service,
        catalog=catalog,
        public_key=key.public_key(),
        identity=identity,
        native_ingress_token=INGRESS,
        workers={"collector": COLLECTOR},
        execution_workers={"executor": EXECUTOR},
        collect=False,
    )
    transport = NativeTransport(
        service="agents",
        base_url="http://127.0.0.1:29090/agents",
        credential=EXECUTOR,
        transport=Bridge(app),
    )

    async def inspect(_settings, agent, *, discover_models):
        assert not discover_models
        return {
            "enabled": agent == "codex",
            "available": True,
            "message": "Fixture",
            "executable": "/fixture/codex",
        }

    worker = WorkbenchWorker(
        transport,
        WorkbenchConfiguration(config, profiles, service),
        tmp_path / "worker",
        inspect=inspect,
        locate=lambda *_: (True, "/fixture/codex", ""),
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agents") as api,
    ):

        def proof(method, path, *, local, user, role="admin"):
            return {
                HEADER: issue_context(
                    Actor(
                        user_id=user,
                        platform_role=role,
                        auth_kind="session",
                        scopes=tuple(sorted(role_scopes(role))),
                        session_id=user,
                        local=local,
                    ),
                    service="agents",
                    method=method,
                    path=path,
                    private_key=key,
                    key_id="test",
                )
            }

        async def call(method, path, *, local=True, user=owner, **kwargs):
            return await api.request(
                method, path, headers=proof(method, path, local=local, user=user), **kwargs
            )

        async def execute(method, path, **kwargs):
            result = asyncio.create_task(call(method, path, **kwargs))
            while not result.done():
                await worker.poll_once()
            return await result

        poll = await api.post(
            "/_native/v1/execution/claim",
            json={"wait_seconds": 0},
            headers={"X-Fpl-Native-Ingress": INGRESS, "Authorization": "Bearer " + COLLECTOR},
        )
        assert poll.status_code == 403
        assert (await call("GET", DIRECTORY_PATH, local=False)).status_code == 403
        assert (
            await call("POST", PROJECT_PATH, local=False, json={"root": str(work)})
        ).status_code == 403
        assert (
            await api.get(
                CATALOG_PATH,
                headers=proof("GET", CATALOG_PATH, local=True, user=other, role="user"),
            )
        ).status_code == 403

        await transport.post("execution/claim", {"wait_seconds": 0})
        directory = await execute("GET", DIRECTORY_PATH, params={"parent": str(work.parent)})
        assert directory.status_code == 200, directory.text
        assert directory.json()["items"][0]["root"] == str(work)
        selected = await execute("POST", PROJECT_PATH, json={"root": str(work)})
        assert selected.status_code == 200, selected.text
        repeated = await execute("POST", PROJECT_PATH, json={"root": str(work)})
        assert repeated.json() == selected.json()
        local = await execute("GET", CATALOG_PATH)
        assert local.json()["recent_projects"][0]["id"] == selected.json()["id"]
        assert local.json()["can_select_directory"] is True
        public = await execute("GET", CATALOG_PATH, local=False)
        assert public.json()["projects"] == [
            {"id": "fixture", "label": "Public authorized fixture"}
        ]
        assert public.json()["recent_projects"] == []
        assert str(work) not in public.text and public.json()["can_select_directory"] is False
        payload = {"project_id": "fixture", "agent_id": "codex"}
        assert (await call("POST", CHATS_PATH, local=False, json=payload)).status_code == 403
        identity.unlocked_until = int(time()) + 60
        chat = await execute("POST", CHATS_PATH, local=False, json=payload)
        assert chat.status_code == 201, chat.text
        assert chat.json()["project_label"] == "Public authorized fixture"
        local_chat = await execute(
            "POST", CHATS_PATH, json={**payload, "project_id": selected.json()["id"]}
        )
        assert local_chat.status_code == 201, local_chat.text
        assert local_chat.json()["project_label"] == work.name
        foreign = await execute(
            "POST", CHATS_PATH, user=other, json={**payload, "project_id": selected.json()["id"]}
        )
        assert foreign.status_code == 404, foreign.text
        different = await execute("GET", CATALOG_PATH, user=other)
        assert different.json()["recent_projects"] == [] and different.json()["projects"] == []

        async def dialogue(agent, executable, _model, prompt, tools, invoke, emit, **_kwargs):
            assert (agent, executable) == ("codex", "/fixture/codex")
            assert '"message": "Write the fixture"' in prompt
            assert {tool["name"] for tool in tools} == {"list_files", "read_file", "write_file"}
            arguments = {"path": "result.txt", "content": "approved fixture"}
            await emit("assistant_delta", {"text": "准备写入"})
            await emit(
                "tool_call",
                {
                    "tool_call_id": "write-one",
                    "tool_name": "write_file",
                    "arguments": arguments,
                },
            )
            result = await invoke("write_file", arguments)
            assert result["path"] == "result.txt"
            await emit(
                "tool_result",
                {
                    "tool_call_id": "write-one",
                    "status": "completed",
                    "result": result,
                },
            )
            await emit("assistant_delta", {"text": "，已写入"})

        worker.dialogue = dialogue
        await transport.post("execution/turns/claim", {"wait_seconds": 0})
        chat_id = local_chat.json()["id"]
        target = turn_path(chat_id)
        message = {"text": "Write the fixture", "request_id": "turn-1"}
        submitted = await call("POST", target, json=message)
        assert submitted.status_code == 202, submitted.text
        turn_id = submitted.json()["id"]
        assert (await call("POST", target, json=message)).json()["id"] == turn_id
        assert (await call("POST", target, user=other, json=message)).status_code == 404
        assert (
            await call("POST", target, json={**message, "text": "different"})
        ).status_code == 409
        running = asyncio.create_task(worker.poll_turn())
        detail_path = f"{CHATS_PATH}/{chat_id}"
        try:
            async with asyncio.timeout(5):
                while True:
                    current = (await call("GET", detail_path)).json()["turns"][-1]
                    if current["approvals"]:
                        break
                    await asyncio.sleep(0.05)
            assert current["answer"] == "准备写入"
            approval = current["approvals"][0]
            assert approval["status"] == "pending" and "action_sha256" not in approval
            assert not (work / "result.txt").exists()
            decision = decision_path(chat_id, turn_id, approval["id"])
            assert (
                await call("POST", decision, user=other, json={"approved": True})
            ).status_code == 404
            assert (
                await call("POST", decision, local=False, json={"approved": True})
            ).status_code == 409
            assert (await call("POST", decision, json={"approved": True})).status_code == 204
            await asyncio.wait_for(running, timeout=5)
        finally:
            if not running.done():
                running.cancel()
            await asyncio.gather(running, return_exceptions=True)
        current = (await call("GET", detail_path)).json()["turns"][-1]
        assert current["status"] == "completed", current
        assert current["answer"] == "准备写入，已写入"
        assert current["approvals"][0]["status"] == "completed"
        assert current["activity"][0]["source_available"] is True
        assert (work / "result.txt").read_text() == "approved fixture"
        preview_path = source_path(chat_id, turn_id)
        assert (
            await call("GET", preview_path, user=other, params={"call_id": "write-one"})
        ).status_code == 404
        assert (await call("GET", preview_path, params={"call_id": "unknown"})).status_code == 404
        preview = await execute("GET", preview_path, params={"call_id": "write-one"})
        assert preview.status_code == 200, preview.text
        assert preview.headers["cache-control"] == "no-store"
        assert (
            preview.json()["path"] == "result.txt" and preview.json()["text"] == "approved fixture"
        )
        assert not app.state.execution_discovery.previews
        assert all(
            "approved fixture" not in file.read_text()
            for file in worker.receipts.root.glob("*.json")
        )
        historical_id = str(uuid4())
        async with app.state.database.sessions(info={"owner_user_id": owner}) as session:
            session.add(
                WorkbenchSession(
                    id=historical_id,
                    owner_user_id=owner,
                    agent_id="codex",
                    native_id=historical_id,
                    cwd=str(work),
                )
            )
            await session.commit()
        history = history_source_path(historical_id)
        assert (
            await call("GET", history, user=other, params={"path": "result.txt"})
        ).status_code == 404
        identity.unlocked_until = 0
        assert (await call("GET", history, params={"path": "result.txt"})).status_code == 403
        identity.unlocked_until = int(time()) + 60
        historical = await execute(
            "GET", history, params={"path": str(work / "result.txt"), "line": 1}
        )
        assert historical.status_code == 200, historical.text
        assert historical.json() == {
            "path": "result.txt",
            "text": "approved fixture",
            "line": 1,
            "diff": None,
        }
        assert historical.headers["cache-control"] == "no-store"
        assert (
            await execute("GET", history, local=False, params={"path": "result.txt"})
        ).status_code == 200
        config.write_text("")
        assert (
            await execute("GET", history, local=False, params={"path": "result.txt"})
        ).status_code == 403
        assert (await execute("GET", history, params={"path": "../result.txt"})).status_code == 404
        config.write_text(configured_project)
        original_read = project_files.read_file

        def revoke_during_read(*args, **kwargs):
            text = original_read(*args, **kwargs)
            identity.revoked = True
            return text

        with monkeypatch.context() as patch:
            patch.setattr(project_files, "read_file", revoke_during_read)
            revoked = await execute("GET", history, params={"path": "result.txt"})
        identity.revoked = False
        assert revoked.status_code == 403
        assert "approved fixture" not in revoked.text
        assert not app.state.execution_discovery.previews
        async with app.state.database.sessions(info={"owner_user_id": owner}) as session:
            jobs = await session.scalars(select(WorkbenchExecutionJob))
            for job in jobs:
                assert "assertion" not in job.payload
                if job.operation == PREVIEW_SOURCE:
                    assert set(job.result) == ({"sha256"} if job.status == "completed" else set())
        entered = asyncio.Event()
        delivered = []

        async def waiting(*_args, instructions, **_kwargs):
            async def ack(identity, text):
                delivered.append((identity, text))
                instructions.acknowledge(identity, "accepted")

            instructions.send = ack
            entered.set()
            await asyncio.Future()

        worker.dialogue = waiting
        next_turn = await call("POST", target, json={**message, "request_id": "turn-revoke"})
        assert next_turn.status_code == 202, next_turn.text
        next_id = next_turn.json()["id"]
        task = asyncio.create_task(worker.poll_turn())
        try:
            await asyncio.wait_for(entered.wait(), timeout=5)
            async with asyncio.timeout(5):
                while (await call("GET", detail_path)).json()["steerable_turn_id"] != next_id:
                    await asyncio.sleep(0.05)
            ready = (await api.get("/ready")).json()
            assert (ready["status"], ready["service"]) == ("ready", "agents")
            steer_path = instruction_path(chat_id, next_id)
            steer_body = {"request_id": "steer-one", "text": "keep the original"}
            inserted = await call("POST", steer_path, json=steer_body)
            assert inserted.status_code == 200 and inserted.json()["status"] == "accepted", (
                inserted.text
            )
            assert (await call("POST", steer_path, json=steer_body)).json() == inserted.json()
            assert delivered == [("steer:steer-one", "keep the original")]
            assert (await call("POST", steer_path, user=other, json=steer_body)).status_code == 404

            queue_body = {"mode": "queue", "text": "queued follow-up"}
            first = await call("POST", target, json={**queue_body, "request_id": "queued-one"})
            second = await call("POST", target, json={**queue_body, "request_id": "queued-two"})
            assert [first.status_code, second.status_code] == [202, 202], (first.text, second.text)
            first_id, second_id = first.json()["id"], second.json()["id"]
            read = (await call("GET", detail_path)).json()
            assert [item["id"] for item in read["queue"]] == [first_id, second_id]
            delete_path = queue_remove_path(chat_id, first_id)
            assert (await call("DELETE", delete_path, user=other)).status_code == 404
            assert (await call("DELETE", delete_path)).status_code == 204
            identity.revoked = True
            await asyncio.wait_for(task, timeout=5)
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        identity.revoked = False
        read = (await call("GET", detail_path)).json()
        last = read["turns"][-1]
        assert last["id"] == next_id and last["status"] == "failed"
        assert read["queue_paused"] is True and [item["id"] for item in read["queue"]] == [
            second_id
        ]

        async def finish_followup(*_args, **_kwargs):
            return None

        worker.dialogue = finish_followup
        assert (await call("POST", queue_resume_path(chat_id))).status_code == 204
        async with asyncio.timeout(5):
            while (await call("GET", detail_path)).json()["queue"]:
                await worker.poll_turn()
        await worker.poll_turn()
        read = (await call("GET", detail_path)).json()
        assert read["turns"][-1]["id"] == second_id and read["turns"][-1]["status"] == "completed"
        identity.revoked = True
        assert (await call("GET", CATALOG_PATH)).status_code == 403
    await transport.close()
    get_settings.cache_clear()
