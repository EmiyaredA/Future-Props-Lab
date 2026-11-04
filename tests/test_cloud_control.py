import asyncio
import os
import sys
from contextlib import aclosing
from uuid import uuid4

import httpx
import pytest

from app.apps.agent_workbench.execution import project_files, runner, storage
from app.apps.agent_workbench.routes import execution
from app.console.cloud_control import access, desktop
from app.console.governance.provisioning import create_account
from app.main import app
from app.runtime.config import CloudProject, get_settings
from app.runtime.db import SessionLocal

pytestmark = pytest.mark.real_auth
PASSWORD = "Cloud-Control-Isolated-Test-2026!"
CLOUD = "/v1/cloud-control"
WORKBENCH = "/v1/agent-workbench"


async def admin_client(local=True):
    async def dispatch(scope, receive, send):
        scope["state"] = {"website_local": local}
        await app(scope, receive, send)

    username = "cloud-test-" + uuid4().hex[:12]
    async with SessionLocal() as db:
        user, _ = await create_account(
            db,
            username=username,
            display_name=username,
            platform_role="admin",
            password=PASSWORD,
        )
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(dispatch),
        base_url="https://test",
    )
    logged = await client.post("/v1/auth/login", json={"username": username, "password": PASSWORD})
    assert logged.status_code == 200
    client.headers.update({"Origin": "https://test", "X-CSRF-Token": client.cookies["fpl_csrf"]})
    return client, user.id


def configure(monkeypatch, *owners):
    settings = get_settings()
    monkeypatch.setattr(settings, "fpl_cloud_control_enabled", True)
    monkeypatch.setattr(settings, "fpl_cloud_control_public_enabled", True)
    monkeypatch.setattr(settings, "fpl_cloud_control_admin_user_ids", os.pathsep.join(owners))


async def enroll(client):
    result = await client.post(CLOUD + "/totp/enroll")
    assert result.status_code == 200, result.text
    secret = result.json()["secret"]
    code = access.totp(secret, int(access.time.time()) // 30)
    result = await client.post(CLOUD + "/totp/confirm", json={"code": code})
    assert result.status_code == 204, result.text
    return code


async def test_totp_unlock_requires_csrf_rejects_replay_and_logout_revokes(monkeypatch):
    client, owner = await admin_client()
    remote, other = await admin_client(local=False)
    configure(monkeypatch, owner, other)
    async with aclosing(client), aclosing(remote):
        assert (await remote.post(CLOUD + "/totp/enroll")).status_code == 403
        assert (
            await remote.post(CLOUD + "/desktop/connect", json={"password": "fixture"})
        ).status_code == 403
        missing_csrf = client.headers.pop("X-CSRF-Token")
        assert (await client.post(CLOUD + "/totp/enroll")).status_code == 403
        client.headers["X-CSRF-Token"] = missing_csrf
        code = await enroll(client)
        assert (await client.get(CLOUD + "/status")).json()["unlocked_until"] > 0
        assert (await client.post(CLOUD + "/totp/verify", json={"code": code})).status_code == 403
        ticket = await client.post(CLOUD + "/desktop/connect", json={"password": "fixture"})
        assert ticket.status_code == 204
        assert "HttpOnly" in ticket.headers["set-cookie"]
        assert desktop.DESKTOP_SOCKET in ticket.headers["set-cookie"]
        assert (await client.post("/v1/auth/logout")).status_code == 204
        assert (
            await client.post(CLOUD + "/desktop/connect", json={"password": "fixture"})
        ).status_code == 401


async def test_guacd_handshake_uses_fixed_target_and_stream_frames():
    reader = asyncio.StreamReader()
    reader.feed_data(
        desktop.instruction("args", "VERSION_1_5_0", "hostname", "port", "password", "disable-copy")
        + desktop.instruction("ready", "test")
        + desktop.instruction("name", "远程")
    )

    class Writer:
        def __init__(self):
            self.output = b""

        def write(self, data):
            self.output += data

        async def drain(self):
            pass

    writer = Writer()
    settings = get_settings()
    source = desktop.GuacdReader(reader)
    await desktop.handshake(source, writer, settings, "fixture")
    assert writer.output.startswith(desktop.instruction("select", "vnc"))
    assert (
        desktop.instruction(
            "connect",
            "VERSION_1_5_0",
            settings.fpl_cloud_control_vnc_host,
            str(settings.fpl_cloud_control_vnc_port),
            "fixture",
            "true",
        )
        in writer.output
    )
    assert (await source.next())[0] == ["name", "远程"]
    assert desktop.parse_instruction("4.mo") is None


def test_file_tools_reject_private_paths_and_changes_after_approval(tmp_path):
    root = tmp_path.resolve()
    (root / "main.txt").write_text("original")
    (root / ".env").write_text("private")
    (root / "redirect").symlink_to(root / ".env")
    assert project_files.list_files(root, ".")["items"] == ["main.txt"]
    with pytest.raises(ValueError):
        project_files.read_file(root, "../private")
    with pytest.raises(ValueError):
        project_files.read_file(root, ".env")
    with pytest.raises(OSError):
        project_files.read_file(root, "redirect")
    expected = project_files.digest("original")
    (root / "main.txt").write_text("other edit")
    with pytest.raises(ValueError, match="已变更"):
        project_files.write_file(root, "main.txt", "approved", expected)
    assert (root / "main.txt").read_text() == "other edit"


async def await_turn(client, path, status):
    for _ in range(100):
        result = await client.get(path)
        assert result.status_code == 200, result.text
        turns = result.json()["turns"]
        if turns and turns[-1]["status"] == status:
            return turns[-1]
        await asyncio.sleep(0.04)
    pytest.fail(f"Expected {status}, got {turns}")


@pytest.mark.parametrize("agent", ["codex", "claude-code", "opencode", "dsh", "pi"])
async def test_managed_chat_keeps_context_and_executes_approved_file_once(
    monkeypatch,
    tmp_path,
    agent,
):
    client, owner = await admin_client()
    other, other_id = await admin_client()
    configure(monkeypatch, owner, other_id)
    root = tmp_path.resolve()
    monkeypatch.setattr(
        get_settings(),
        "fpl_cloud_control_projects",
        {
            "project": CloudProject(label="Test project", root=str(root), user_ids=[owner]),
        },
    )
    captured = []

    async def resolve(*_args, **_kwargs):
        return "/fixture/cli"

    async def codex(_executable, _root, _model, prompt, _tools, call, emit, **_kwargs):
        captured.append(prompt)
        if len(captured) != 2:
            await call("write_file", {"path": "hello.txt", "content": "approved"})
        await emit("assistant_delta", {"text": "hello"})

    async def claude(_executable, _root, _model, prompt, _config, emit, **_kwargs):
        captured.append(prompt)
        await emit("assistant_delta", {"text": "hello"})

    async def converse(_agent, *args, **kwargs):
        await claude(*args, **kwargs)

    monkeypatch.setattr(execution, "resolve_connection", resolve)
    monkeypatch.setattr(runner, "resolve_connection", resolve)
    monkeypatch.setattr(runner, "codex", codex)
    monkeypatch.setattr(runner, "claude", claude)
    monkeypatch.setattr(runner, "converse", converse)
    async with aclosing(client), aclosing(other):
        await enroll(client)
        response = await client.post(
            WORKBENCH + "/chats",
            json={
                "project_id": "project",
                "agent_id": agent,
            },
        )
        assert response.status_code == 201, response.text
        path = f"{WORKBENCH}/chats/{response.json()['id']}"
        assert (await other.get(path)).status_code == 404
        body = {"request_id": "first", "text": "first prompt"}
        first = await client.post(path + "/turns", json=body)
        assert first.status_code == 202, first.text
        replay = await client.post(path + "/turns", json=body)
        assert replay.json()["id"] == first.json()["id"]
        if agent == "codex":
            pending = await await_turn(client, path, "waiting_approval")
            assert not (root / "hello.txt").exists()
            identity = pending["approvals"][0]["id"]
            approval = f"{path}/turns/{pending['id']}/approvals/{identity}"
            assert (await client.post(approval, json={"approved": True})).status_code == 204
        await await_turn(client, path, "completed")
        if agent == "codex":
            assert (root / "hello.txt").read_text() == "approved"
            assert (await client.post(approval, json={"approved": True})).status_code == 409
        assert (
            await client.post(path + "/turns", json={"request_id": "second", "text": "follow up"})
        ).status_code == 202
        await await_turn(client, path, "completed")
        assert len(captured) == 2
        assert "first prompt" in captured[-1] and "follow up" in captured[-1]
        if agent == "codex":
            assert (
                await client.post(path + "/turns", json={"request_id": "stop", "text": "stop me"})
            ).status_code == 202
            pending = await await_turn(client, path, "waiting_approval")
            assert (await client.post(path + f"/turns/{pending['id']}/stop")).status_code == 204
            stopped = await await_turn(client, path, "cancelled")
            assert stopped["approvals"][0]["status"] == "expired"


async def desktop_asgi(client, origin, *, local=True):
    incoming, outgoing = asyncio.Queue(), asyncio.Queue()
    incoming.put_nowait({"type": "websocket.connect"})
    cookie = "; ".join(
        f"{name}={client.cookies[name]}" for name in ("fpl_session", desktop.DESKTOP_COOKIE)
    )
    task = asyncio.create_task(
        app(
            {
                "type": "websocket",
                "scheme": "ws" if local else "wss",
                "path": desktop.DESKTOP_SOCKET,
                "query_string": b"",
                "root_path": "",
                "subprotocols": ["guacamole"],
                "headers": [(b"origin", origin.encode()), (b"cookie", cookie.encode())],
                "state": {"website_local": local},
                "client": ("127.0.0.1", 10000),
            },
            incoming.get,
            outgoing.put,
        )
    )
    return task, incoming, outgoing


@pytest.mark.parametrize("local", [True, False])
async def test_desktop_websocket_checks_origin_consumes_ticket_and_closes_on_logout(
    monkeypatch, local
):
    client, owner = await admin_client(local=local)
    configure(monkeypatch, owner)
    settings = get_settings()
    if not local:
        monkeypatch.setattr(settings, "fpl_cloud_control_public_desktop_vnc_only", True)
        monkeypatch.setattr(settings, "fpl_remote_web_origin", "https://test")
    received = asyncio.Queue()

    async def fake_guacd(reader, writer):
        stream = desktop.GuacdReader(reader)
        try:
            assert (await stream.next())[0] == ["select", "vnc"]
            writer.write(desktop.instruction("args", "VERSION_1_5_0", "hostname", "password"))
            await writer.drain()
            for _ in range(6):
                fields, _ = await stream.next()
            assert fields[0] == "connect"
            writer.write(desktop.instruction("ready", "isolated"))
            writer.write(desktop.instruction("size", "0", "640", "400"))
            await writer.drain()
            await received.put((await stream.next())[0])
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(fake_guacd, "127.0.0.1", 0)
    monkeypatch.setattr(
        get_settings(), "fpl_cloud_control_guacd_port", server.sockets[0].getsockname()[1]
    )
    async with server, aclosing(client), asyncio.timeout(10):
        if not local:
            status = (await client.get(CLOUD + "/status")).json()
            assert status["desktop_configured"] and status["desktop_authorized"]
            assert not status["enabled"] and not status["enrolled"]
            catalog = (await client.get(WORKBENCH + "/execution/catalog")).json()
            assert not catalog["enabled"]
            monkeypatch.setattr(settings, "fpl_cloud_control_public_enabled", False)
            denied = await client.post(CLOUD + "/desktop/connect", json={"password": "fixture"})
            assert denied.status_code == 403
            monkeypatch.setattr(settings, "fpl_cloud_control_public_enabled", True)
            monkeypatch.setattr(settings, "fpl_cloud_control_admin_user_ids", "")
            denied = await client.post(CLOUD + "/desktop/connect", json={"password": "fixture"})
            assert denied.status_code == 403
            monkeypatch.setattr(settings, "fpl_cloud_control_admin_user_ids", owner)
        issued = await client.post(CLOUD + "/desktop/connect", json={"password": "fixture"})
        assert issued.status_code == 204
        if not local:
            assert "Secure" in issued.headers["set-cookie"]
        task, _, out = await desktop_asgi(client, "https://untrusted.example", local=local)
        assert (await out.get())["type"] == "websocket.close"
        await task
        origin = "http://127.0.0.1:3000" if local else "https://test"
        task, incoming, out = await desktop_asgi(client, origin, local=local)
        assert (await out.get())["subprotocol"] == "guacamole"
        await out.get()
        assert (await out.get())["text"] == "4.size,1.0,3.640,3.400;"
        await incoming.put({"type": "websocket.receive", "text": "3.key,2.97,1.1;"})
        assert await received.get() == ["key", "97", "1"]
        await incoming.put({"type": "websocket.disconnect", "code": 1000})
        await task
        task, _, out = await desktop_asgi(client, origin, local=local)
        assert (await out.get())["code"] == 4403
        await task
        assert (
            await client.post(CLOUD + "/desktop/connect", json={"password": "fixture"})
        ).status_code == 204
        task, incoming, out = await desktop_asgi(client, origin, local=local)
        assert (await out.get())["subprotocol"] == "guacamole"
        await out.get()
        await out.get()
        await incoming.put({"type": "websocket.receive", "text": "3.key,2.97,1.0;"})
        assert await received.get() == ["key", "97", "0"]
        assert (await client.post("/v1/auth/logout")).status_code == 204
        assert "desktop_authorization_required" in (await out.get())["text"]
        assert (await out.get())["type"] == "websocket.close"
        await task


async def test_sandboxed_preset_can_read_project_but_cannot_read_private_paths(tmp_path):
    from app.apps.agent_workbench.execution.commands import available, run_command
    from app.runtime.config import CloudCommand

    if not available():
        pytest.skip("macOS sandbox required")
    root = tmp_path.resolve()
    (root / "allowed.txt").write_text("sample")
    (root / ".env").write_text("private fixture")
    good = await run_command(
        str(root), CloudCommand(label="read", argv=["/bin/cat", "allowed.txt"])
    )
    assert good == {"exit_code": 0, "output": "sample"}
    denied = await run_command(str(root), CloudCommand(label="read", argv=["/bin/cat", ".env"]))
    assert denied["exit_code"] != 0 and "private fixture" not in denied["output"]


async def test_restart_expires_pending_approval_and_preserves_unknown_result():
    from app.apps.agent_workbench.execution.models import WorkbenchChat, WorkbenchTurn

    client, owner = await admin_client()
    identity = str(uuid4())
    async with aclosing(client):
        async with SessionLocal() as db:
            db.add(
                WorkbenchChat(
                    id=identity,
                    owner_user_id=owner,
                    project_id="fixture",
                    agent_id="codex",
                    created_at=1,
                )
            )
            await db.flush()
            db.add(
                WorkbenchTurn(
                    id=identity,
                    owner_user_id=owner,
                    chat_id=identity,
                    client_id=identity,
                    position=1,
                    prompt="test",
                    answer="partial",
                    status="waiting_approval",
                    approvals=[
                        dict(
                            id="first", kind="write", title="a.txt", preview="", status="executing"
                        ),
                        dict(
                            id="second", kind="write", title="b.txt", preview="", status="pending"
                        ),
                    ],
                    revision=1,
                )
            )
            await db.commit()
        async with SessionLocal() as db:
            await storage.interrupt_all(db)
        chat = (await client.get(f"{WORKBENCH}/chats/{identity}")).json()
        turn = chat["turns"][0]
        assert turn["status"] == "interrupted" and turn["answer"] == "partial"
        assert [item["status"] for item in turn["approvals"]] == ["unknown", "expired"]


@pytest.mark.parametrize("vnc_only", [False, True])
async def test_local_setup_is_scoped_and_applies_without_restart(monkeypatch, tmp_path, vnc_only):
    from app.console.cloud_control import setup
    from app.console.governance import code_agent_connections
    from app.runtime import config

    file = tmp_path / "config.toml"
    file.write_text(
        f'[security]\nsecrets_key = "{get_settings().fpl_secrets_key}"\n# keep\n'
        f"[cloud_control]\npublic_desktop_vnc_only = {str(vnc_only).lower()}\n"
    )
    monkeypatch.setattr(config, "CONFIG_FILE", file)
    monkeypatch.setattr(setup, "CONFIG_FILE", file)
    monkeypatch.setattr(code_agent_connections, "CONFIG_FILE", file)
    project = (tmp_path / "example").resolve()
    project.mkdir()

    async def probe(_port, **_kwargs):
        return True

    monkeypatch.setattr(setup, "probe_port", probe)
    client, owner = await admin_client()
    other, _ = await admin_client(local=False)
    async with aclosing(client), aclosing(other):
        assert (await other.get(CLOUD + "/settings")).status_code == 403
        first = (await client.get(CLOUD + "/settings")).json()
        assert first["public_desktop_vnc_only"] is vnc_only
        body = {
            "revision": first["revision"],
            "host_label": "Mac test",
            "public_enabled": False,
            "projects": [str(project)],
        }
        if not vnc_only:
            blocked = await client.put(CLOUD + "/settings", json={**body, "public_enabled": True})
            assert blocked.status_code == 409
        body["public_enabled"] = vnc_only
        saved = await client.put(CLOUD + "/settings", json=body)
        assert saved.status_code == 200, saved.text
        assert "secrets_key" not in saved.text
        assert saved.json()["guacd_ready"]
        assert saved.json()["public_enabled"] is vnc_only
        assert "# keep" in file.read_text()
        assert (await client.put(CLOUD + "/settings", json=body)).status_code == 409
        status = (await client.get(CLOUD + "/status")).json()
        assert status["enabled"] and status["desktop_authorized"]
        assert config.get_cloud_settings().fpl_cloud_control_admin_user_ids == owner

        async def installed(settings, agent, **_kwargs):
            enabled = agent == "codex" and bool(settings.fpl_code_agents_codex_enabled)
            return {
                "enabled": enabled,
                "available": enabled,
                "executable": sys.executable,
                "message": "已连接" if enabled else "部署尚未启用此 Agent",
            }

        monkeypatch.setattr(storage, "inspect_connection", installed)
        monkeypatch.setattr(code_agent_connections, "inspect_connection", installed)
        enable = "/v1/code-agents/codex/enable"
        assert (await other.post(enable)).status_code == 403
        assert (await client.post(enable)).status_code == 204
        assert config.get_cloud_settings().fpl_code_agents_codex_executable == sys.executable
        catalog = (await client.get(WORKBENCH + "/execution/catalog")).json()
        assert catalog["agents"] == [
            {"id": "codex", "label": "Codex", "available": True, "status": "已连接"}
        ]


async def test_idle_preference_checks_revision_and_desktop_activity_is_explicit(monkeypatch):
    client, owner = await admin_client()
    configure(monkeypatch, owner)
    async with aclosing(client):
        body = {"idle_minutes": 15, "revision": 0}
        assert (await client.put(CLOUD + "/desktop/idle", json=body)).json() == {
            "idle_minutes": 15,
            "revision": 1,
        }
        assert (await client.put(CLOUD + "/desktop/idle", json=body)).status_code == 409
        assert (
            await client.put(CLOUD + "/desktop/idle", json={"idle_minutes": 4, "revision": 1})
        ).status_code == 422
        assert (await client.get(CLOUD + "/status")).json()["idle_minutes"] == 15
    inputs = desktop.DesktopInput(lambda: 10)
    assert not inputs.track("sync", ["10"])
    assert inputs.track("key", ["97", "1"])
    assert not inputs.track("key", ["97", "1"])
    assert inputs.track("mouse", ["12", "13", "1"])
    assert not inputs.track("mouse", ["12", "13", "1"])

    class Writer:
        def __init__(self):
            self.data = b""

        def write(self, value):
            self.data += value

    writer = Writer()
    inputs.release(writer)
    assert writer.data == b"3.key,2.97,1.0;5.mouse,2.12,2.13,1.0;"


async def test_public_desktop_proof_outlives_agent_unlock_until_session_logout(monkeypatch):
    local, owner = await admin_client()
    remote, other = await admin_client(local=False)
    configure(monkeypatch, owner, other)
    async with aclosing(local), aclosing(remote):
        key = (await local.post(CLOUD + "/totp/enroll")).json()["secret"]
        now = int(access.time.time())
        code = access.totp(key, now // 30)
        assert (await local.post(CLOUD + "/totp/confirm", json={"code": code})).status_code == 204
        remote.cookies = local.cookies
        remote.headers["X-CSRF-Token"] = remote.cookies["fpl_csrf"]
        login = {"password": "temporary"}
        assert (await remote.post(CLOUD + "/desktop/connect", json=login)).status_code == 403
        result = await remote.post(
            CLOUD + "/totp/verify",
            json={
                "code": access.totp(key, now // 30 + 1),
                "desktop": True,
            },
        )
        assert result.status_code == 204, result.text
        assert (await remote.get(CLOUD + "/status")).json()["desktop_authorized"]
        monkeypatch.setattr(access.time, "time", lambda: now + 20 * 60)
        state = (await remote.get(CLOUD + "/status")).json()
        assert state["unlocked_until"] == 0 and state["desktop_authorized"]
        assert (await remote.post(CLOUD + "/desktop/connect", json=login)).status_code == 204
        assert (await remote.post("/v1/auth/logout")).status_code == 204
        assert (await remote.post(CLOUD + "/desktop/connect", json=login)).status_code == 401


async def test_vnc_auth_rejection_is_distinct_from_no_service():
    from app.console.cloud_control.vnc_check import password_rejected

    async def reject(reader, writer):
        try:
            writer.write(b"RFB 003.889\n")
            await writer.drain()
            assert await reader.readexactly(12) == b"RFB 003.008\n"
            writer.write(b"\x01\x02")
            await writer.drain()
            assert await reader.readexactly(1) == b"\x02"
            writer.write(bytes(range(16)))
            await writer.drain()
            assert len(await reader.readexactly(16)) == 16
            writer.write(b"\x00\x00\x00\x01")
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(reject, "127.0.0.1", 0)
    settings = get_settings().model_copy(
        update={
            "fpl_cloud_control_vnc_host": "127.0.0.1",
            "fpl_cloud_control_vnc_port": server.sockets[0].getsockname()[1],
        }
    )
    async with server:
        assert await password_rejected(settings, "test")
    assert not await password_rejected(settings, "test")


async def test_desktop_password_is_redacted_and_connection_attempts_are_limited(monkeypatch):
    client, owner = await admin_client()
    configure(monkeypatch, owner)
    async with aclosing(client):
        oversized = "secret-not-for-response-" * 12
        result = await client.post(CLOUD + "/desktop/connect", json={"password": oversized})
        assert result.status_code == 422
        assert oversized not in result.text
        for _ in range(8):
            result = await client.post(CLOUD + "/desktop/connect", json={"password": "test"})
            assert result.status_code == 204
        assert (
            await client.post(CLOUD + "/desktop/connect", json={"password": "test"})
        ).status_code == 429


async def test_idle_watcher_rechecks_active_connection_when_preference_changes(monkeypatch):
    from types import SimpleNamespace

    clock = 0.0
    minutes = 30
    polled = asyncio.Event()

    async def authorized(_db, _principal, **_kwargs):
        return True

    async def preferences(_db, _owner):
        polled.set()
        return minutes, 1

    monkeypatch.setattr(desktop, "desktop_authorized", authorized)
    monkeypatch.setattr(desktop, "desktop_preferences", preferences)
    inputs = desktop.DesktopInput(lambda: clock)
    changed = asyncio.Event()
    task = asyncio.create_task(
        desktop.watch_access(SimpleNamespace(user_id="fixture"), True, inputs, changed)
    )
    try:
        await asyncio.wait_for(polled.wait(), 1)
        clock = 6 * 60
        minutes = 5
        changed.set()
        assert await asyncio.wait_for(task, 1) == "desktop_idle_timeout"
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
