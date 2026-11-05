import asyncio
import base64
import io
import json
import os
import sys
from contextlib import aclosing, asynccontextmanager
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from app.console.cloud_control import access, desktop
from app.console.governance.provisioning import create_account
from app.main import app
from app.runtime.config import CloudProject, get_settings
from app.runtime.db import SessionLocal
from db.migrations import runner as migration_runner
from studio.apps.agent_workbench.execution import events, project_files, projects, runner, storage
from studio.apps.agent_workbench.transport.website import execution

pytestmark = pytest.mark.real_auth
PASSWORD = "Cloud-Control-Isolated-Test-2026!"
CLOUD = "/v1/cloud-control"
WORKBENCH = "/v1/agent-workbench"


async def admin_client(local=True, *, role="admin"):
    async def dispatch(scope, receive, send):
        scope["state"] = {"website_local": local}
        await app(scope, receive, send)

    username = "cloud-test-" + uuid4().hex[:12]
    async with SessionLocal() as db:
        user, _ = await create_account(
            db,
            username=username,
            display_name=username,
            platform_role=role,
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


@pytest.mark.parametrize("local", [True, False])
async def test_guacd_handshake_uses_fixed_target_and_stream_frames(local):
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
    await desktop.handshake(source, writer, settings, "fixture", local=local)
    image_types = (
        ("image/png", "image/jpeg") if local else ("image/png", "image/jpeg", "image/webp")
    )
    assert desktop.instruction("image", *image_types) in writer.output
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


async def test_desktop_tunnel_ping_keeps_guacd_alive_without_keyboard_activity():
    pings = iter((1, 5, 6, 10))
    now = 0
    replies = []
    upstream = []
    ping = "0.,4.ping,1.1;"

    class Socket:
        async def receive_text(self):
            nonlocal now
            now = next(pings, None)
            if now is None:
                raise EOFError
            return ping

        async def send_text(self, message):
            replies.append(message)

    class Writer:
        def write(self, message):
            upstream.append(message)

        async def drain(self):
            pass

    inputs = desktop.DesktopInput(lambda: now)
    with pytest.raises(EOFError):
        await desktop.browser_input(Socket(), Writer(), inputs, desktop.DesktopTransfer())
    assert replies == [ping] * 4
    assert upstream == [desktop.instruction("nop")] * 2
    assert inputs.last_activity == 0


async def test_public_first_frame_compacts_interleaved_png_tiles():
    png = io.BytesIO()
    Image.effect_noise((256, 256), 60).save(png, "PNG")
    encoded = base64.b64encode(png.getvalue()).decode()
    half = len(encoded) // 2
    startup = desktop.PublicDesktopImages()
    messages = [
        ("img", "1", "14", "0", "image/png", "0", "0"),
        ("img", "2", "14", "0", "image/png", "256", "0"),
        ("blob", "1", encoded[:half]),
        ("blob", "2", encoded[:half]),
        ("blob", "2", encoded[half:]),
        ("end", "2"),
        ("blob", "1", encoded[half:]),
        ("end", "1"),
        ("sync", "1"),
    ]
    cursor_sync = desktop.instruction("sync", "0").decode()
    assert await startup.output(["sync", "0"], cursor_sync) == [cursor_sync]
    output = []
    for fields in messages:
        output.extend(await startup.output(list(fields), desktop.instruction(*fields).decode()))
    assert sum(map(len, output)) < len(encoded)
    decoded = [desktop.parse_instruction(raw)[0] for raw in output]
    headers = [fields for fields in decoded if fields[0] == "img"]
    assert [fields[4:] for fields in headers] == [
        ["image/webp", "0", "0"],
        ["image/webp", "256", "0"],
    ]
    for stream in ("1", "2"):
        chunks = [fields[2] for fields in decoded if fields[:2] == ["blob", stream]]
        with Image.open(io.BytesIO(base64.b64decode("".join(chunks)))) as image:
            assert image.size == (256, 256)
    assert [fields for fields in decoded if fields[0] in {"end", "sync"}] == [
        ["end", "2"],
        ["end", "1"],
        ["sync", "1"],
    ]


async def test_public_desktop_compacts_large_updates_after_the_first_frame():
    images = desktop.PublicDesktopImages()

    async def send_tile(data, sync):
        fields = [
            ("img", "1", "14", "0", "image/webp", "0", "0"),
            ("blob", "1", base64.b64encode(data).decode()),
            ("end", "1"),
            ("sync", sync),
        ]
        source = [desktop.instruction(*item).decode() for item in fields]
        output = []
        for item, raw in zip(fields, source, strict=True):
            output.extend(await images.output(list(item), raw))
        return source, output

    small = io.BytesIO()
    Image.new("RGB", (32, 32), "blue").save(small, "WEBP")
    source, output = await send_tile(small.getvalue(), "1")
    assert output == source
    source, output = await send_tile(small.getvalue(), "2")
    assert output == source

    large = io.BytesIO()
    Image.effect_noise((512, 512), 60).save(large, "WEBP", lossless=True)
    source, output = await send_tile(large.getvalue(), "3")
    assert sum(map(len, output)) < sum(map(len, source)) // 2
    assert output[-1] == source[-1]


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


def test_project_migration_preserves_existing_chat_binding(tmp_path, monkeypatch):
    database = tmp_path / "previous-workbench.db"
    with monkeypatch.context() as patch:
        patch.setattr(migration_runner, "MIGRATIONS", migration_runner.MIGRATIONS[:-2])
        patch.setattr(migration_runner, "LATEST_MIGRATION_ID", "0121_cloud_desktop_sessions")
        migration_runner.apply_migrations(database)
    with migration_runner.connect_database(database) as connection:
        connection.executescript("""
            INSERT INTO users (id, username, username_normalized, password_hash, platform_role)
                VALUES ('owner', 'owner', 'owner', 'test', 'admin');
            INSERT INTO workbench_chats (id, owner_user_id, project_id, agent_id, created_at)
                VALUES ('chat', 'owner', 'legacy-project', 'codex', 1);
            INSERT INTO workbench_turns (
                id, owner_user_id, chat_id, client_id, position, prompt, answer, status,
                approvals, revision
            ) VALUES (
                'turn', 'owner', 'chat', 'client', 1, 'prompt', 'answer', 'completed', '[]', 2
            );
        """)
    assert migration_runner.apply_migrations(database) == ("0123_workbench_turns", True)
    assert migration_runner.apply_migrations(database) == ("0123_workbench_turns", False)
    with migration_runner.connect_database(database) as connection:
        assert connection.execute("SELECT project_id FROM workbench_chats").fetchone() == (
            "legacy-project",
        )
        assert connection.execute("SELECT answer FROM workbench_turns").fetchone() == ("answer",)
        assert connection.execute("SELECT count(*) FROM workbench_projects").fetchone() == (0,)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


async def await_turn(client, path, status):
    for _ in range(100):
        result = await client.get(path)
        assert result.status_code == 200, result.text
        turns = result.json()["turns"]
        if turns and turns[-1]["status"] == status:
            return turns[-1]
        await asyncio.sleep(0.04)
    pytest.fail(f"Expected {status}, got {turns}")


async def test_local_project_picker_keeps_recent_projects_private(monkeypatch, tmp_path):
    client, owner = await admin_client()
    other, other_id = await admin_client()
    remote, remote_id = await admin_client(local=False)
    member, member_id = await admin_client(role="user")
    configure(monkeypatch, owner, other_id, remote_id, member_id)
    monkeypatch.setattr(get_settings(), "fpl_cloud_control_public_desktop_vnc_only", False)
    root = tmp_path.resolve() / "home"
    anchor = root / "Projects"
    project = anchor / "work"
    child = project / "subproject"
    child.mkdir(parents=True)
    legacy = tmp_path.resolve() / "legacy"
    legacy.mkdir()
    monkeypatch.setattr(
        get_settings(),
        "fpl_cloud_control_projects",
        {"legacy": CloudProject(label="Legacy", root=str(legacy), user_ids=[owner])},
    )
    (anchor / ".hidden").mkdir()
    (anchor / "secrets").mkdir()
    (anchor / "alias").symlink_to(project)
    (anchor / "document.txt").touch()
    monkeypatch.setattr(Path, "home", lambda: root)

    async def inspect(*_args, **_kwargs):
        return {"enabled": False}

    async def connection(*_args, **_kwargs):
        return "/fixture/cli"

    monkeypatch.setattr(storage, "inspect_connection", inspect)
    monkeypatch.setattr(execution, "resolve_connection", connection)
    directories = WORKBENCH + "/execution/directories"
    registry = WORKBENCH + "/execution/projects"
    catalog = WORKBENCH + "/execution/catalog"
    async with aclosing(client), aclosing(other), aclosing(remote), aclosing(member):
        for forbidden in (remote, member):
            assert (await forbidden.get(directories)).status_code == 403
            assert (await forbidden.post(registry, json={"root": str(project)})).status_code == 403
        assert (await remote.get(catalog)).json()["suggested_directories"] == []
        assert (await client.get(directories)).json()["items"] == [
            {"root": str(anchor), "label": "项目"}
        ]
        listing = await client.get(directories, params={"parent": str(anchor)})
        assert listing.headers["cache-control"] == "no-store"
        parent = listing.json()
        assert parent == {
            "parent": None,
            "selectable": False,
            "items": [{"root": str(project), "label": "work"}],
        }
        leaf = (await client.get(directories, params={"parent": str(project)})).json()
        assert leaf["selectable"] and leaf["parent"] == str(anchor)
        assert leaf["items"] == [{"root": str(child), "label": "subproject"}]
        assert (await client.get(directories, params={"parent": str(root)})).status_code == 409
        for invalid in (
            anchor,
            anchor / "alias",
            anchor / "secrets",
            anchor / "work" / ".." / "work",
        ):
            assert (await client.post(registry, json={"root": str(invalid)})).status_code == 409
        registrations = await asyncio.gather(
            *(client.post(registry, json={"root": str(project)}) for _ in range(3))
        )
        assert all(created.status_code == 200 for created in registrations)
        selected = registrations[0].json()
        assert all(created.json() == selected for created in registrations)
        assert (await client.post(registry, json={"root": str(project) + "/"})).json() == selected
        assert (await other.get(catalog)).json()["recent_projects"] == []
        assert (await other.post(registry, json={"root": str(project)})).json()["id"] != selected[
            "id"
        ]
        assert (await client.get(catalog)).json()["recent_projects"] == [
            {**selected, "root": str(project)}
        ]
        body = {"project_id": selected["id"], "agent_id": "codex"}
        assert (await client.post(WORKBENCH + "/chats", json=body)).status_code == 403
        await enroll(client)
        await enroll(other)
        assert (await other.post(WORKBENCH + "/chats", json=body)).status_code == 404
        opened = await client.post(WORKBENCH + "/chats", json=body)
        assert opened.status_code == 201, opened.text
        path = f"{WORKBENCH}/chats/{opened.json()['id']}"
        remote.cookies.update(client.cookies)
        remote.headers["X-CSRF-Token"] = client.headers["X-CSRF-Token"]
        assert (
            await remote.post("/v1/auth/reauth", json={"password": PASSWORD})
        ).status_code == 204
        assert (await remote.get(catalog)).json()["recent_projects"] == []
        assert (
            await remote.post(WORKBENCH + "/chats", json={**body, "project_id": "legacy"})
        ).status_code == 201
        assert (await remote.post(WORKBENCH + "/chats", json=body)).status_code == 404
        assert (
            await remote.post(path + "/turns", json={"request_id": "public", "text": "hi"})
        ).status_code == 404
        project.rename(anchor / "moved")
        assert (await client.get(catalog)).json()["recent_projects"] == []
        assert (await client.get(path)).json()["project_label"] == "work"
        failed = await client.post(path + "/turns", json={"request_id": "moved", "text": "hi"})
        assert failed.status_code == 409


async def test_slow_project_check_releases_sqlite_and_rechecks_binding(monkeypatch, tmp_path):
    client, owner = await admin_client()
    configure(monkeypatch, owner)
    settings = get_settings()
    roots = {name: tmp_path / name for name in ("slow", "fast")}
    for root in roots.values():
        root.mkdir()
    bindings = {
        name: CloudProject(label=name, root=str(root.resolve()), user_ids=[owner])
        for name, root in roots.items()
    }
    monkeypatch.setattr(settings, "fpl_cloud_control_projects", bindings)
    check = projects.validate_project_root
    loop = asyncio.get_running_loop()
    entered, release = asyncio.Event(), Event()

    def slow_check(root, current_settings):
        if root == bindings["slow"].root:
            loop.call_soon_threadsafe(entered.set)
            assert release.wait(10)
        return check(root, current_settings)

    async def connection(*_args, **_kwargs):
        return "/fixture/cli"

    monkeypatch.setattr(projects, "validate_project_root", slow_check)
    monkeypatch.setattr(execution, "resolve_connection", connection)
    async with aclosing(client):
        await enroll(client)
        path = WORKBENCH + "/chats"
        slow = asyncio.create_task(
            client.post(path, json={"project_id": "slow", "agent_id": "codex"})
        )
        try:
            await asyncio.wait_for(entered.wait(), 3)
            fast = await asyncio.wait_for(
                client.post(path, json={"project_id": "fast", "agent_id": "codex"}), 3
            )
            assert fast.status_code == 201, fast.text
            monkeypatch.setattr(
                settings, "fpl_cloud_control_projects", {**bindings, "slow": bindings["fast"]}
            )
        finally:
            release.set()
            result = await slow
        assert result.status_code == 409, result.text


async def test_execution_stream_releases_session_before_sending(monkeypatch):
    open_sessions = 0

    @asynccontextmanager
    async def session():
        nonlocal open_sessions
        open_sessions += 1
        try:
            yield object()
        finally:
            open_sessions -= 1

    async def authorized(*_args):
        return True

    async def version(*_args):
        return ("turn", 1)

    monkeypatch.setattr(events, "SessionLocal", session)
    monkeypatch.setattr(events, "valid_auth", authorized)
    monkeypatch.setattr(events, "get_chat", authorized)
    monkeypatch.setattr(events, "latest_turn_version", version)
    request = SimpleNamespace(is_disconnected=lambda: asyncio.sleep(0, result=False))
    async with aclosing(events.stream(request, SimpleNamespace(user_id="owner"), "chat")) as stream:
        assert (await anext(stream)).startswith("event: change")
        assert open_sessions == 0
        assert (await anext(stream)).startswith(": heartbeat")
        assert open_sessions == 0


@pytest.mark.parametrize("agent", ["codex", "claude-code", "opencode", "dsh", "pi"])
async def test_managed_chat_keeps_context_and_executes_approved_file_once(
    monkeypatch,
    tmp_path,
    agent,
):
    client, owner = await admin_client()
    other, other_id = await admin_client()
    configure(monkeypatch, owner, other_id)
    root = tmp_path.resolve() / "work"
    root.mkdir()
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

    async def dialogue(kind, _executable, _model, prompt, _tools, call, emit, **_kwargs):
        assert kind == agent
        captured.append(prompt)
        if kind == "codex" and len(captured) != 2:
            await call("write_file", {"path": "hello.txt", "content": "approved"})
        await emit("assistant_delta", {"text": "hello"})

    monkeypatch.setattr(execution, "resolve_connection", resolve)
    monkeypatch.setattr(runner, "resolve_connection", resolve)
    monkeypatch.setattr(runner, "run_dialogue", dialogue)
    async with aclosing(client), aclosing(other):
        await enroll(client)
        identity = "project"
        if agent == "pi":
            picked = await client.post(WORKBENCH + "/execution/projects", json={"root": str(root)})
            assert picked.status_code == 200, picked.text
            identity = picked.json()["id"]
        response = await client.post(
            WORKBENCH + "/chats",
            json={
                "project_id": identity,
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

            assert (
                await client.post(path + "/turns", json={"request_id": "swap", "text": "swap"})
            ).status_code == 202
            pending = await await_turn(client, path, "waiting_approval")
            original = root.rename(root.with_name("old-work"))
            root.mkdir()
            identity = pending["approvals"][0]["id"]
            approval = f"{path}/turns/{pending['id']}/approvals/{identity}"
            assert (await client.post(approval, json={"approved": True})).status_code == 204
            done = await await_turn(client, path, "completed")
            assert done["approvals"][0]["status"] == "failed"
            assert not (root / "hello.txt").exists()
            assert (original / "hello.txt").read_text() == "approved"

            loop = asyncio.get_running_loop()
            entered, release = asyncio.Event(), Event()
            write = project_files.write_file

            def delayed_write(*args, **kwargs):
                loop.call_soon_threadsafe(entered.set)
                assert release.wait(10)
                return write(*args, **kwargs)

            monkeypatch.setattr(project_files, "write_file", delayed_write)
            assert (
                await client.post(path + "/turns", json={"request_id": "writing", "text": "write"})
            ).status_code == 202
            pending = await await_turn(client, path, "waiting_approval")
            identity = pending["approvals"][0]["id"]
            turn_path = f"{path}/turns/{pending['id']}"
            assert (
                await client.post(turn_path + f"/approvals/{identity}", json={"approved": True})
            ).status_code == 204
            try:
                await asyncio.wait_for(entered.wait(), 3)
                stop = asyncio.create_task(client.post(turn_path + "/stop"))
                await await_turn(client, path, "cancelling")
            finally:
                release.set()
            assert (await stop).status_code == 204
            stopped = await await_turn(client, path, "cancelled")
            assert stopped["approvals"][0]["status"] == "unknown"


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
        enroll_client, owner = await admin_client()
        configure(monkeypatch, owner)
        async with aclosing(enroll_client):
            key = (await enroll_client.post(CLOUD + "/totp/enroll")).json()["secret"]
            counter = int(access.time.time()) // 30
            confirmed = await enroll_client.post(
                CLOUD + "/totp/confirm", json={"code": access.totp(key, counter)}
            )
            assert confirmed.status_code == 204
            client.cookies = enroll_client.cookies
            client.headers["X-CSRF-Token"] = client.cookies["fpl_csrf"]
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
            assert status["desktop_configured"] and not status["desktop_authorized"]
            assert not status["enabled"] and not status["enrolled"]
            auth = {"code": access.totp(key, counter + 1), "desktop": True}
            premature = await client.post(CLOUD + "/totp/verify", json=auth)
            assert premature.status_code == 403
            assert premature.json()["code"] == "reauthentication_required"
            assert (
                await client.post("/v1/auth/reauth", json={"password": PASSWORD})
            ).status_code == 204
            assert (await client.post(CLOUD + "/totp/verify", json=auth)).status_code == 204
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
    from app.runtime.config import CloudCommand
    from studio.apps.agent_workbench.execution.commands import available, run_command

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
    from studio.apps.agent_workbench.execution.models import WorkbenchChat, WorkbenchTurn

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
        '[cloud_control.projects.legacy]\nlabel = "Legacy"\n'
        f'root = "{tmp_path.resolve()}/example"\nuser_ids = ["legacy-user"]\n'
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
        }
        blocked = await client.put(CLOUD + "/settings", json={**body, "public_enabled": True})
        assert blocked.status_code == 409
        saved = await client.put(CLOUD + "/settings", json=body)
        assert saved.status_code == 200, saved.text
        assert "secrets_key" not in saved.text
        assert saved.json()["guacd_ready"]
        assert saved.json()["public_enabled"] is False
        assert "# keep" in file.read_text()
        assert "projects" not in first and "projects" not in saved.json()
        assert config.get_cloud_settings().fpl_cloud_control_projects["legacy"].user_ids == [
            "legacy-user"
        ]
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
        assert (
            await remote.post("/v1/auth/reauth", json={"password": PASSWORD})
        ).status_code == 204
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


async def test_workbench_queue_is_fifo_idempotent_and_pauses_on_stop_or_restart(
    monkeypatch,
    tmp_path,
):
    client, owner = await admin_client()
    other, other_id = await admin_client()
    configure(monkeypatch, owner, other_id)
    root = tmp_path.resolve()
    monkeypatch.setattr(
        get_settings(),
        "fpl_cloud_control_projects",
        {"project": CloudProject(label="Queue fixture", root=str(root), user_ids=[owner])},
    )
    entered = asyncio.Queue()
    gates = {}
    accepted = []

    async def resolve(*_args, **_kwargs):
        return "/fixture/cli"

    async def dialogue(
        _agent, _executable, _model, prompt, _tools, _call, emit, *, instructions, **_kwargs
    ):
        message = json.loads(prompt.split("\n", 1)[1])["message"]
        gates[message] = asyncio.Event()

        async def steer(identity, text):
            accepted.append(text)
            instructions.acknowledge(identity, "accepted")

        instructions.send = steer
        await emit("assistant_delta", {"text": "处理中"})
        await entered.put(message)
        await gates[message].wait()

    monkeypatch.setattr(execution, "resolve_connection", resolve)
    monkeypatch.setattr(runner, "resolve_connection", resolve)
    monkeypatch.setattr(runner, "run_dialogue", dialogue)
    monkeypatch.setattr(app.state, "workbench_runs", runner.WorkbenchRuns())
    async with aclosing(client), aclosing(other):
        await enroll(client)
        result = await client.post(
            WORKBENCH + "/chats", json={"project_id": "project", "agent_id": "codex"}
        )
        assert result.status_code == 201, result.text
        path = f"{WORKBENCH}/chats/{result.json()['id']}"

        async def send(text, mode="queue"):
            response = await client.post(
                path + "/turns", json={"request_id": text, "text": text, "mode": mode}
            )
            assert response.status_code == 202, response.text
            return response.json()["id"]

        async def started(text):
            assert await asyncio.wait_for(entered.get(), 5) == text

        first = await send("first", "immediate")
        await started("first")
        async with SessionLocal() as db:
            chat_id = result.json()["id"]
            before_queue = await storage.latest_turn_version(db, owner, chat_id)

        second = await send("second")
        assert await send("second") == second
        removed = await send("remove me")
        third = await send("third")
        snapshot = (await client.get(path)).json()
        assert [item["id"] for item in snapshot["queue"]] == [second, removed, third]
        assert [turn["id"] for turn in snapshot["turns"]] == [first]
        assert snapshot["steerable_turn_id"] == first

        instruction = {"request_id": "insert", "text": "keep the existing tests"}
        endpoint = f"{path}/turns/{first}/instructions"
        assert (await client.post(endpoint, json=instruction)).json()["status"] == "accepted"
        assert (await client.post(endpoint, json=instruction)).json()["status"] == "accepted"
        assert accepted == [instruction["text"]]
        async with SessionLocal() as db:
            queued_version = await storage.latest_turn_version(db, owner, chat_id)
            assert queued_version != before_queue
            await storage.append_answer(db, (owner, chat_id, first), "more")
            assert await storage.latest_turn_version(db, owner, chat_id) != queued_version
        assert (await other.delete(f"{path}/queue/{removed}")).status_code in (403, 404)
        assert (await client.delete(f"{path}/queue/{removed}")).status_code == 204
        gates["first"].set()
        await started("second")
        assert (await client.delete(f"{path}/queue/{second}")).status_code == 409
        assert (await client.post(f"{path}/turns/{second}/stop")).status_code == 204
        snapshot = (await client.get(path)).json()
        assert snapshot["queue_paused"]
        assert [item["id"] for item in snapshot["queue"]] == [third]
        assert snapshot["turns"][-1]["status"] == "cancelled"

        async with SessionLocal() as db:
            await storage.interrupt_all(db)
        assert (await client.post(f"{path}/queue/resume")).status_code == 204
        await started("third")
        gates["third"].set()
        await await_turn(client, path, "completed")
        assert (await client.get(path)).json()["queue"] == []
