"""Verify separate Mac discovery credentials, cloud authority, and owned project selection."""

import asyncio
import json
from pathlib import Path
from time import time
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from app.apps.agent_workbench.execution import projects
from app.capabilities.identity.permissions import role_scopes
from app.runtime.config import get_settings
from fpl_agents.application import create_app
from fpl_agents.migrations.registry import MIGRATIONS
from fpl_agents.models import WorkbenchExecutionJob
from fpl_host.transport import NativeTransport
from fpl_host.workbench_worker import WorkbenchConfiguration, WorkbenchWorker
from fpl_runtime.claims import HEADER, Actor, issue_context, verify_context
from fpl_runtime.cloud_authority import CloudAuthority
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog
from fpl_runtime.workbench_execution import (
    CATALOG_PATH,
    CHATS_PATH,
    DIRECTORY_PATH,
    PROJECT_PATH,
    decision_path,
    turn_path,
)

INGRESS = "isolated-workbench-ingress-" * 2
COLLECTOR = "isolated-workbench-collector-" * 2
EXECUTOR = "isolated-workbench-executor-" * 2


class Identity:
    def __init__(self, key):
        self.key = key
        self.revoked = False
        self.unlocked_until = 0

    async def cloud_authority(self, *, assertion, method, path):
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
    catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
    service = tmp_path / "service"
    work = tmp_path / "projects" / "Owned"
    profiles = tmp_path / "agent-runtime"
    for path in (service, work, profiles):
        path.mkdir(parents=True)
    config = tmp_path / "workbench.toml"
    config.write_text(
        '[cloud_control.projects.fixture]\nlabel = "Public authorized fixture"\n'
        + f"root = {json.dumps(str(work))}\nuser_ids = [{json.dumps(owner)}]\n"
    )
    monkeypatch.setenv("FPL_DATABASE_PATH", str(service / "service.db"))
    get_settings.cache_clear()
    monkeypatch.setattr(projects, "anchors", lambda: {work.parent: "Fixture projects"})
    monkeypatch.setattr(projects, "suggestions", lambda _settings: [])
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
        async with app.state.database.sessions(info={"owner_user_id": owner}) as session:
            jobs = await session.scalars(select(WorkbenchExecutionJob))
            assert all("assertion" not in item.payload for item in jobs)
        entered = asyncio.Event()

        async def waiting(*_args, **_kwargs):
            entered.set()
            await asyncio.Future()

        worker.dialogue = waiting
        next_turn = await call("POST", target, json={**message, "request_id": "turn-revoke"})
        assert next_turn.status_code == 202, next_turn.text
        task = asyncio.create_task(worker.poll_turn())
        try:
            await asyncio.wait_for(entered.wait(), timeout=5)
            identity.revoked = True
            await asyncio.wait_for(task, timeout=5)
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        identity.revoked = False
        last = (await call("GET", detail_path)).json()["turns"][-1]
        assert last["id"] == next_turn.json()["id"] and last["status"] == "failed"
        identity.revoked = True
        assert (await call("GET", CATALOG_PATH)).status_code == 403
    await transport.close()
    get_settings.cache_clear()
