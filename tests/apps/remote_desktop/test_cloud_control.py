import asyncio
import base64
import io
import os
import sys
from contextlib import aclosing, asynccontextmanager
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from PIL import Image
from sqlalchemy import text

from db.migrations import runner as migration_runner
from studio.apps.agent_workbench.execution import (
    project_files,
    storage,
)
from studio.apps.agent_workbench.transport import (
    turn_events as events,
)
from studio.apps.identity.storage import cloud_access as access
from studio.apps.remote_desktop.transport import guacamole as desktop
from studio.assembly.website import desktop as desktop_binding
from studio.assembly.website.account_provisioning import create_account
from studio.config.settings import get_settings
from studio.contracts.identity.cloud_authority import DESKTOP_COOKIE, DESKTOP_SOCKET
from studio.runtime.time import utc_now
from website_test_support import SessionLocal, app

pytestmark = pytest.mark.real_auth
PASSWORD = "Cloud-Control-Isolated-Test-2026!"
CLOUD = "/v1/cloud-control"


async def admin_client(local=True, *, role="admin", website=app):
    async def dispatch(scope, receive, send):
        scope["state"] = {"website_local": local}
        await website(scope, receive, send)

    username = "cloud-test-" + uuid4().hex[:12]
    async with website.state.database.sessions() as db:
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


async def unlock(client, purpose="agent"):
    reauth = await client.post("/v1/auth/reauth", json={"password": PASSWORD})
    assert reauth.status_code == 204, reauth.text
    result = await client.post(CLOUD + "/unlock", json={"purpose": purpose})
    assert result.status_code == 204, result.text


@pytest.mark.parametrize("local", [True, False])
async def test_agent_unlock_requires_recent_password_and_csrf(monkeypatch, local):
    client, owner = await admin_client(local=local)
    regular, other = await admin_client(local=local, role="user")
    configure(monkeypatch, owner, other)
    body = {"purpose": "agent"}
    async with aclosing(client), aclosing(regular):
        assert (await regular.post(CLOUD + "/unlock", json=body)).status_code == 403
        initial = await client.post(CLOUD + "/unlock", json=body)
        assert initial.status_code == 403
        assert initial.json()["code"] == "reauthentication_required"
        invalid = await client.post("/v1/auth/reauth", json={"password": "incorrect"})
        assert invalid.status_code == 401 and invalid.json()["code"] == "invalid_credentials"
        assert (await client.post(CLOUD + "/unlock", json=body)).status_code == 403
        assert (
            await client.post("/v1/auth/reauth", json={"password": PASSWORD})
        ).status_code == 204
        csrf = client.headers.pop("X-CSRF-Token")
        assert (await client.post(CLOUD + "/unlock", json=body)).status_code == 403
        client.headers["X-CSRF-Token"] = csrf
        with monkeypatch.context() as patch:
            patch.setattr(
                app.state.cloud_unlocks, "clock", lambda: utc_now() + timedelta(minutes=11)
            )
            stale = await client.post(CLOUD + "/unlock", json=body)
            assert stale.status_code == 403 and stale.json()["code"] == "reauthentication_required"
        if not local:
            with monkeypatch.context() as patch:
                patch.setattr(get_settings(), "fpl_cloud_control_public_enabled", False)
                assert (await client.post(CLOUD + "/unlock", json=body)).status_code == 403
        assert (await client.post(CLOUD + "/unlock", json=body)).status_code == 204
        state = (await client.get(CLOUD + "/status")).json()
        assert 895 <= state["unlocked_until"] - access.time.time() <= 900
        assert state["desktop_authorized"] is local
        assert "enrolled" not in state
        assert (await client.post("/v1/auth/logout")).status_code == 204
        assert (await client.post(CLOUD + "/unlock", json=body)).status_code == 401


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


async def test_desktop_tunnel_ping_is_echoed_without_keyboard_activity():
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
    assert upstream == []
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


async def test_public_relay_releases_pending_image_when_guacd_sync_stalls(monkeypatch):
    monkeypatch.setattr(desktop, "FIRST_IMAGE_BUFFER_SECONDS", 0.01)
    monkeypatch.setattr(
        desktop, "compress_desktop_tile", lambda chunks: "AA==" if chunks == ["AAAA"] else None
    )
    stream = asyncio.StreamReader()
    outgoing = asyncio.Queue()
    transfer = desktop.DesktopTransfer()
    socket = SimpleNamespace(send_text=outgoing.put)
    ticket = SimpleNamespace(password="fixture")
    attempts = SimpleNamespace(clear=lambda _: None)
    header = desktop.instruction("img", "1", "14", "0", "image/png", "0", "0")
    blob = desktop.instruction("blob", "1", "AA==")
    end = desktop.instruction("end", "1")
    complete_header = desktop.instruction("img", "2", "14", "0", "image/png", "1", "0")
    compact_header = desktop.instruction("img", "2", "14", "0", "image/webp", "1", "0")
    complete_blob = desktop.instruction("blob", "2", "AAAA")
    compact_blob = desktop.instruction("blob", "2", "AA==")
    complete_end = desktop.instruction("end", "2")
    sync = desktop.instruction("sync", "7")
    task = asyncio.create_task(
        desktop.browser_output(
            socket,
            desktop.GuacdReader(stream),
            "owner",
            ticket,
            None,
            transfer,
            local=False,
            attempts=attempts,
        )
    )
    try:
        async with asyncio.timeout(2):
            stream.feed_data(
                header + blob + complete_header + complete_blob + complete_end + end[:4]
            )
            assert await outgoing.get() == header.decode()
            assert await outgoing.get() == blob.decode()
            assert await outgoing.get() == compact_header.decode()
            assert await outgoing.get() == compact_blob.decode()
            assert await outgoing.get() == complete_end.decode()
            assert transfer.buffer_expiries == 1
            stream.feed_data(end[4:] + sync)
            assert await outgoing.get() == end.decode()
            assert await outgoing.get() == sync.decode()
            stream.feed_eof()
            with pytest.raises(EOFError):
                await task
            assert transfer.sync_sent == 1 and transfer.image_chunks == 2
            assert transfer.upstream_end == "guacd_read_EOFError"
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


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
    before_projects = next(
        index
        for index, migration in enumerate(migration_runner.MIGRATIONS)
        if migration.migration_id == "0122_workbench_projects"
    )
    with monkeypatch.context() as patch:
        patch.setattr(migration_runner, "MIGRATIONS", migration_runner.MIGRATIONS[:before_projects])
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
    assert migration_runner.apply_migrations(database) == (
        migration_runner.LATEST_MIGRATION_ID,
        True,
    )
    assert migration_runner.apply_migrations(database) == (
        migration_runner.LATEST_MIGRATION_ID,
        False,
    )
    with migration_runner.connect_database(database) as connection:
        assert connection.execute("SELECT project_id FROM workbench_chats").fetchone() == (
            "legacy-project",
        )
        assert connection.execute("SELECT answer FROM workbench_turns").fetchone() == ("answer",)
        assert connection.execute("SELECT count(*) FROM workbench_projects").fetchone() == (0,)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


async def test_execution_stream_releases_session_before_sending():
    open_sessions = 0

    @asynccontextmanager
    async def session():
        nonlocal open_sessions
        open_sessions += 1
        try:
            yield SimpleNamespace(info={})
        finally:
            open_sessions -= 1

    async def authorized(*_args):
        return True

    async def version(*_args):
        return ("turn", 1)

    from studio.apps.agent_workbench.storage.turn_versions import SqlTurnVersions

    versions = SqlTurnVersions(session, load=version, readiness=lambda *_args: None)
    request = SimpleNamespace(is_disconnected=lambda: asyncio.sleep(0, result=False))
    async with aclosing(
        events.stream_turns(
            request,
            SimpleNamespace(user_id="owner"),
            "chat",
            versions=versions,
            authorizer=authorized,
        )
    ) as stream:
        assert (await anext(stream)).startswith("event: change")
        assert open_sessions == 0
        assert (await anext(stream)).startswith(": heartbeat")
        assert open_sessions == 0


async def desktop_asgi(client, origin, *, local=True):
    incoming, outgoing = asyncio.Queue(), asyncio.Queue()
    incoming.put_nowait({"type": "websocket.connect"})
    cookie = "; ".join(f"{name}={client.cookies[name]}" for name in ("fpl_session", DESKTOP_COOKIE))
    task = asyncio.create_task(
        app(
            {
                "type": "websocket",
                "scheme": "ws" if local else "wss",
                "path": DESKTOP_SOCKET,
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
    upstream_heartbeat = asyncio.Event()
    monkeypatch.setattr(desktop, "GUACD_KEEPALIVE_SECONDS", 0.05)

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
            while True:
                fields, _ = await stream.next()
                if fields != ["nop"]:
                    await received.put(fields)
                    break
                upstream_heartbeat.set()
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
            assert not status["enabled"]
            auth = {"purpose": "desktop"}
            premature = await client.post(CLOUD + "/unlock", json=auth)
            assert premature.status_code == 403
            assert premature.json()["code"] == "reauthentication_required"
            await unlock(client, "desktop")
            assert (
                await client.post(CLOUD + "/unlock", json={"purpose": "agent"})
            ).status_code == 403
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
        async with SessionLocal() as writer:
            await writer.execute(text("BEGIN IMMEDIATE"))
            task, incoming, out = await desktop_asgi(client, origin, local=local)
            assert (await out.get())["subprotocol"] == "guacamole"
            await out.get()
            assert (await out.get())["text"] == "4.size,1.0,3.640,3.400;"
            await asyncio.wait_for(upstream_heartbeat.wait(), 1)
            await incoming.put({"type": "websocket.receive", "text": "3.key,2.97,1.1;"})
            assert await received.get() == ["key", "97", "1"]
            await writer.rollback()
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
    from studio.apps.agent_workbench.execution.commands import available, run_command
    from studio.config.settings import CloudCommand

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


@pytest.mark.parametrize("vnc_only", [False, True])
async def test_local_setup_is_scoped_and_applies_without_restart(monkeypatch, tmp_path, vnc_only):
    from studio.assembly.website import cloud_setup as setup
    from studio.config import settings as config
    from studio.host.agent_execution.cli import connection_configuration as code_agent_connections
    from studio.host.deployment import cloud_setup as host_setup

    file = tmp_path / "config.toml"
    file.write_text(
        f'[security]\nsecrets_key = "{get_settings().fpl_secrets_key}"\n# keep\n'
        f"[cloud_control]\npublic_desktop_vnc_only = {str(vnc_only).lower()}\n"
        '[cloud_control.projects.legacy]\nlabel = "Legacy"\n'
        f'root = "{tmp_path.resolve()}/example"\nuser_ids = ["legacy-user"]\n'
    )
    monkeypatch.setattr(config, "CONFIG_FILE", file)
    monkeypatch.setattr(setup, "CONFIG_FILE", file)
    from studio.assembly.website import bindings

    monkeypatch.setattr(bindings, "CONFIG_FILE", file)
    project = (tmp_path / "example").resolve()
    project.mkdir()

    async def probe(_port, **_kwargs):
        return True

    monkeypatch.setattr(host_setup, "probe_port", probe)
    client, owner = await admin_client()
    other, _ = await admin_client(local=False)
    async with aclosing(client), aclosing(other):
        assert (await other.get(CLOUD + "/settings")).status_code == 403
        first = (await client.get(CLOUD + "/settings")).json()
        assert first["public_desktop_vnc_only"] is vnc_only
        body = {
            "revision": first["revision"],
            "host_label": "Mac test",
            "public_enabled": True,
        }
        assert (
            await client.post("/v1/auth/reauth", json={"password": PASSWORD})
        ).status_code == 204
        saved = await client.put(CLOUD + "/settings", json=body)
        assert saved.status_code == 200, saved.text
        assert "secrets_key" not in saved.text
        assert saved.json()["guacd_ready"]
        assert saved.json()["public_enabled"] is True
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
    remote, owner = await admin_client(local=False)
    configure(monkeypatch, owner)
    async with aclosing(remote):
        login = {"password": "temporary"}
        assert (await remote.post(CLOUD + "/desktop/connect", json=login)).status_code == 403
        await unlock(remote)
        assert (await remote.post(CLOUD + "/desktop/connect", json=login)).status_code == 403
        await unlock(remote, "desktop")
        deadline = (await remote.get(CLOUD + "/status")).json()["unlocked_until"]
        assert deadline > 0
        assert (await remote.get(CLOUD + "/status")).json()["desktop_authorized"]
        monkeypatch.setattr(access.time, "time", lambda: deadline)
        state = (await remote.get(CLOUD + "/status")).json()
        assert state["unlocked_until"] == 0 and state["desktop_authorized"]
        assert (await remote.post(CLOUD + "/desktop/connect", json=login)).status_code == 204
        assert (await remote.post("/v1/auth/logout")).status_code == 204
        assert (await remote.post(CLOUD + "/desktop/connect", json=login)).status_code == 401


async def test_vnc_auth_rejection_is_distinct_from_no_service():
    from studio.apps.remote_desktop.clients.vnc_probe import password_rejected

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


async def test_idle_watcher_rechecks_active_connection_when_preference_changes(monkeypatch):
    clock = 0.0
    minutes = 30
    polled = asyncio.Event()

    async def authorized(_db, _principal, **_kwargs):
        return True

    async def preferences(*, owner):
        assert owner == "fixture"
        polled.set()
        return SimpleNamespace(idle_minutes=minutes)

    monkeypatch.setattr(desktop_binding, "desktop_authorized", authorized)
    inputs = desktop.DesktopInput(lambda: clock)
    changed = asyncio.Event()
    connection = desktop_binding.DesktopConnection(
        sessions=SessionLocal,
        settings_reader=get_settings,
        attempts=app.state.auth_attempts,
        preferences=SimpleNamespace(read=preferences),
    )
    principal = SimpleNamespace(user_id="fixture")

    async def check():
        return await connection.access(principal, True)

    task = asyncio.create_task(desktop.watch_access(inputs, changed, check))
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
