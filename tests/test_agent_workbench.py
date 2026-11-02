"""Storage/API tests use isolated native sources and isolated FPL databases only."""

import asyncio
import json
import sqlite3
from pathlib import Path

import httpx
import pytest
import zstandard
from fastapi import FastAPI, Request
from sqlalchemy import event, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.apps.agent_workbench.events import event_page
from app.apps.agent_workbench.models import WorkbenchCheckpoint, WorkbenchSession
from app.apps.agent_workbench.routes import router
from app.apps.agent_workbench.sync.projection import apply_batch
from app.apps.agent_workbench.sync.runner import WorkbenchSyncRunner
from app.capabilities.agents.sessions import get_adapter
from app.capabilities.agents.sessions.access import LocalSourceAccess
from app.capabilities.identity.principal import StudioPrincipal
from app.console.models import User
from app.deps import SessionDep, db_session, require_studio_auth
from app.orm import bind_owner
from db.migrations import apply_migrations


def encode(*records):
    return b"".join(json.dumps(record, ensure_ascii=False).encode() + b"\n" for record in records)


def test_upgrade_from_account_schema_preserves_data_and_migration_history(tmp_path, monkeypatch):
    from db.migrations import runner

    database = tmp_path / "upgrade.db"
    index = next(
        i for i, m in enumerate(runner.MIGRATIONS) if m.migration_id == "0117_agent_workbench"
    )
    through_workbench = runner.MIGRATIONS[: index + 1]
    monkeypatch.setattr(runner, "MIGRATIONS", through_workbench)
    monkeypatch.setattr(runner, "LATEST_MIGRATION_ID", "0117_agent_workbench")
    prefix = through_workbench[:-1]
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", prefix)
        patch.setattr(runner, "LATEST_MIGRATION_ID", prefix[-1].migration_id)
        apply_migrations(database)
    with sqlite3.connect(database) as db:
        db.execute(
            "INSERT INTO users(id,username,username_normalized,password_hash,platform_role) "
            "VALUES ('existing','existing','existing','fixture','user')"
        )
        before = db.execute("SELECT * FROM schema_migrations ORDER BY rowid").fetchall()
    assert apply_migrations(database) == ("0117_agent_workbench", True)
    assert apply_migrations(database) == ("0117_agent_workbench", False)
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT id FROM users").fetchall() == [("existing",)]
        history = db.execute("SELECT * FROM schema_migrations ORDER BY rowid").fetchall()
        assert history[:-1] == before
        assert db.execute("SELECT count(*) FROM agent_workbench_sources").fetchone() == (0,)
        assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def codex_records(native_id="native", surface="app"):
    return [
        {
            "type": "session_meta",
            "payload": {
                "id": native_id,
                "cwd": "/fixture/demo",
                "source": "vscode" if surface == "app" else "cli",
                "originator": "Codex Desktop" if surface == "app" else "codex_cli_rs",
            },
        },
        {
            "type": "response_item",
            "timestamp": "2026-11-01T10:00:00Z",
            "payload": {
                "id": "message-1",
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "检查预览状态"}],
            },
        },
        {
            "type": "response_item",
            "timestamp": "2026-11-01T10:00:01Z",
            "payload": {
                "id": "message-2",
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "fixture searchable response"}],
            },
        },
    ]


@pytest.fixture
async def store(tmp_path):
    database = tmp_path / "fpl.db"
    apply_migrations(database)
    engine = create_async_engine("sqlite+aiosqlite:///" + str(database))

    @event.listens_for(engine.sync_engine, "connect")
    def foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        for owner in ["alpha", "beta"]:
            db.add(
                User(
                    id=owner,
                    username=owner,
                    username_normalized=owner,
                    password_hash="fixture",
                    must_change_password=False,
                    platform_role="admin" if owner == "beta" else "user",
                )
            )
        await db.commit()
    application = FastAPI()
    application.state.workbench_native = LocalSourceAccess()
    application.include_router(router, prefix="/v1")

    async def session_dependency():
        async with sessions() as db:
            yield db

    async def auth(request: Request, session: SessionDep):
        owner = request.headers.get("x-owner", "alpha")
        bind_owner(session, owner)
        return StudioPrincipal(
            user_id=owner,
            platform_role="admin" if owner == "beta" else "user",
            auth_kind=request.headers.get("x-auth-kind", "session"),
            must_change_password=False,
            scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
            session_id="fixture-session",
        )

    @application.middleware("http")
    async def private_fixture(request, call_next):
        request.state.website_local = request.headers.get("x-private") == "yes"
        return await call_next(request)

    application.dependency_overrides[db_session] = session_dependency
    application.dependency_overrides[require_studio_auth] = auth
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application), base_url="http://fixture"
    ) as client:
        yield sessions, client
    await engine.dispose()


async def bind(client, root, agent="codex", **extra):
    result = await client.post(
        "/v1/agent-workbench/sources",
        headers={"x-private": "yes", **extra},
        json={"agent_id": agent, "label": "fixture source", "root": str(root)},
    )
    assert result.status_code == 201, result.text
    return result.json()


async def scan(runner):
    runner.last_poll.clear()
    runner.backoffs.clear()
    await runner.process_once()
    await asyncio.gather(*(task for _, task in runner.source_tasks.values()))
    await runner.stop()


@pytest.mark.parametrize("surface", ["app", "cli"])
async def test_history_incremental_restart_search_and_private_sources(store, tmp_path, surface):
    sessions, client = store
    root = tmp_path / "sessions"
    root.mkdir()
    path = root / "record.jsonl"
    original = encode(*codex_records(surface=surface))
    path.write_bytes(original)
    source = await bind(client, root)
    runner = WorkbenchSyncRunner(sessions)
    await scan(runner)
    page = (await client.get("/v1/agent-workbench/sessions")).json()
    assert len(page["items"]) == 1
    item = page["items"][0]
    assert item["origins"] == [surface]
    assert item["can_send"] is False
    history_url = f"/v1/agent-workbench/sessions/{item['id']}/history"
    history = (await client.get(history_url)).json()
    assert len(history["items"]) == 2
    assert path.read_bytes() == original
    assert (await client.get("/v1/agent-workbench/sessions?q=searchable")).json()["items"][0][
        "id"
    ] == item["id"]
    addition = codex_records()[2]
    addition["payload"]["id"] = "message-3"
    # Identical text with a distinct native ID must remain a separate message.
    with path.open("ab") as fd:
        fd.write(encode(addition))
    await scan(WorkbenchSyncRunner(sessions))
    updated = (await client.get(history_url)).json()
    assert len(updated["items"]) == 3
    assert updated["change_cursor"] > history["change_cursor"]
    assert len((await client.get("/v1/agent-workbench/sessions")).json()["items"]) == 1
    for url in ["/v1/agent-workbench/sources", "/v1/agent-workbench/sessions?q=searchable"]:
        data = (await client.get(url, headers={"x-owner": "beta"})).json()
        assert data == [] or data["items"] == []
    for suffix in ["", "/history", "/events"]:
        assert (
            await client.get(
                f"/v1/agent-workbench/sessions/{item['id']}{suffix}", headers={"x-owner": "beta"}
            )
        ).status_code == 404
    # Admin cannot claim a child of another account's bound physical source.
    child = root / "child"
    child.mkdir()
    assert (
        await client.post(
            "/v1/agent-workbench/sources",
            headers={"x-private": "yes", "x-owner": "beta"},
            json={"agent_id": "codex", "label": "other", "root": str(child)},
        )
    ).status_code == 409
    # Changing the parser must not let another account claim the same native files.
    assert (
        await client.post(
            "/v1/agent-workbench/sources",
            headers={"x-private": "yes", "x-owner": "beta"},
            json={"agent_id": "claude-code", "label": "other parser", "root": str(child)},
        )
    ).status_code == 409
    assert (
        await client.get(
            f"/v1/agent-workbench/operations/{source['id']}", headers={"x-owner": "beta"}
        )
    ).status_code == 404


def test_complete_records_utf8_rotation_and_unsupported_format(tmp_path):
    path = tmp_path / "record.jsonl"
    records = codex_records()
    first = encode(records[0])
    second = encode(records[1])
    path.write_bytes(first + second[:-4])
    adapter = get_adapter("codex")
    batch = adapter.read_history(str(tmp_path), path.name, {})
    assert batch.entries == []
    with path.open("ab") as fd:
        fd.write(second[-4:])
    updated = adapter.watch(str(tmp_path), path.name, batch.checkpoint)
    assert updated.entries[0].text == "检查预览状态"
    replacement = tmp_path / "next.jsonl"
    replacement.write_bytes(encode(*codex_records("new-id")))
    replacement.replace(path)
    rotated = adapter.watch(str(tmp_path), path.name, updated.checkpoint)
    assert rotated.reset and rotated.info.native_id == "new-id"
    path.write_bytes(encode({"type": "new-format", "secret": "must not display"}))
    with pytest.raises(ValueError, match="格式不支持"):
        adapter.read_history(str(tmp_path), path.name, {})


@pytest.mark.parametrize("entrypoint,expected", [("claude-desktop-3p", "app"), ("sdk-cli", "cli")])
def test_claude_app_and_cli_native_markers(tmp_path, entrypoint, expected):
    path = tmp_path / "claude.jsonl"
    path.write_bytes(
        encode(
            {
                "type": "user",
                "sessionId": "claude-native",
                "uuid": "u1",
                "cwd": "/fixture/project",
                "entrypoint": entrypoint,
                "message": {"role": "user", "content": "hello"},
            },
            {"type": "api-request-blob", "message": {"content": "must not display"}},
        )
    )
    batch = get_adapter("claude-code").read_history(str(tmp_path), path.name, {})
    assert batch.info.origins == [expected]
    assert len(batch.entries) == 1 and batch.entries[0].text == "hello"


async def test_pi_branches_include_metadata_ancestors(store, tmp_path):
    sessions, client = store
    root = tmp_path / "pi"
    root.mkdir()
    records = [
        {"type": "session", "version": 3, "id": "pi-native", "cwd": "/fixture"},
        {
            "type": "message",
            "id": "a",
            "parentId": None,
            "message": {"role": "user", "content": "root"},
        },
        {"type": "model_change", "id": "m", "parentId": "a", "modelId": "fixture-model"},
        {
            "type": "message",
            "id": "b",
            "parentId": "m",
            "message": {"role": "assistant", "content": [{"type": "text", "text": "old branch"}]},
        },
        {
            "type": "message",
            "id": "c",
            "parentId": "m",
            "message": {"role": "assistant", "content": [{"type": "text", "text": "new branch"}]},
        },
    ]
    (root / "pi.jsonl").write_bytes(encode(*records))
    await bind(client, root, "pi")
    await scan(WorkbenchSyncRunner(sessions))
    item = (await client.get("/v1/agent-workbench/sessions")).json()["items"][0]
    url = f"/v1/agent-workbench/sessions/{item['id']}/history"
    latest = (await client.get(url)).json()
    assert latest["branches"] == ["b", "c"]
    assert [entry["text"] for entry in latest["items"]] == ["root", "new branch"]
    previous = (await client.get(url + "?branch=b")).json()
    assert [entry["text"] for entry in previous["items"]] == ["root", "old branch"]
    assert (await client.get(url + "?branch=missing")).status_code == 422


async def test_codex_native_title_index_updates_without_becoming_message_history(store, tmp_path):
    sessions, client = store
    (tmp_path / "record.jsonl").write_bytes(encode(*codex_records()))
    index = tmp_path / "session_index.jsonl"
    index.write_bytes(encode({"id": "native", "thread_name": "原生名称"}))
    (tmp_path / "history.jsonl").write_bytes(encode({"display": "CLI prompt history"}))
    assert get_adapter("codex").discover(str(tmp_path)) == ["record.jsonl"]
    await bind(client, tmp_path)
    await scan(WorkbenchSyncRunner(sessions))
    first = (await client.get("/v1/agent-workbench/sessions")).json()["items"][0]
    assert first["title"] == "原生名称"
    with index.open("ab") as fd:
        fd.write(encode({"id": "native", "thread_name": "原端改名"}))
        fd.write(b'{"id":"native","thread_name":"unfinished')
    await scan(WorkbenchSyncRunner(sessions))
    updated = (await client.get(f"/v1/agent-workbench/sessions/{first['id']}")).json()
    assert updated["title"] == "原端改名"
    history = (await client.get(f"/v1/agent-workbench/sessions/{first['id']}/history")).json()
    assert len(history["items"]) == 2


def test_plain_history_uses_bounded_batches_without_compressed_expansion_limit(
    tmp_path, monkeypatch
):
    from app.capabilities.agents.sessions import files

    monkeypatch.setattr(files, "MAX_CHUNK", 128)
    monkeypatch.setattr(files, "MAX_EXPANDED", 128)
    data = encode(*codex_records())
    (tmp_path / "plain.jsonl").write_bytes(data)
    (tmp_path / "compressed.jsonl").write_bytes(zstandard.ZstdCompressor().compress(data))
    adapter = get_adapter("codex")
    batch = adapter.read_history(str(tmp_path), "plain.jsonl", {})
    entries = list(batch.entries)
    while not batch.complete:
        batch = adapter.watch(str(tmp_path), "plain.jsonl", batch.checkpoint)
        entries.extend(batch.entries)
    assert len(entries) == 2
    with pytest.raises(ValueError, match="展开体积超过限制"):
        adapter.read_history(str(tmp_path), "compressed.jsonl", {})


def test_codex_large_image_record_keeps_text_without_copying_embedded_image(tmp_path):
    records = codex_records()
    records[1]["payload"]["content"].append(
        {"type": "input_image", "image_url": "data:image/png;base64," + "A" * (9 * 1024 * 1024)}
    )
    path = tmp_path / "record.jsonl"
    path.write_bytes(encode(*records))
    adapter = get_adapter("codex")
    first = adapter.read_history(str(tmp_path), path.name, {})
    assert any(entry.text == "检查预览状态" for entry in first.entries)
    assert all(len(entry.text) < 100 for entry in first.entries)
    second = adapter.watch(str(tmp_path), path.name, first.checkpoint)
    assert second.complete and len(second.entries) == 1


def test_legacy_codex_checkpoint_does_not_reindex_for_dsh_parser_upgrade(tmp_path):
    path = tmp_path / "record.jsonl"
    path.write_bytes(zstandard.ZstdCompressor().compress(encode(*codex_records())))
    adapter = get_adapter("codex")
    first = adapter.read_history(str(tmp_path), path.name, {})
    assert first.complete and len(first.entries) == 2
    legacy_state = {k: v for k, v in first.checkpoint.items() if k != "normalization_version"}
    updated = adapter.watch(str(tmp_path), path.name, legacy_state)
    assert updated.complete and not updated.reset and updated.entries == []
    assert updated.checkpoint["offset"] == first.checkpoint["offset"]


def test_codex_compressed_jsonl_archive_and_incremental_follow(tmp_path):
    root = tmp_path / "archived_sessions"
    root.mkdir()
    path = root / "rollout.jsonl"
    compressor = zstandard.ZstdCompressor()
    path.write_bytes(compressor.compress(encode(*codex_records("compressed", "cli"))))
    adapter = get_adapter("codex")
    first = adapter.read_history(str(root), path.name, {})
    assert first.info.native_id == "compressed" and first.info.archived
    assert first.info.origins == ["cli"]
    assert len(first.entries) == 2 and first.complete
    new_message = codex_records("compressed", "cli")[-1]
    new_message["payload"]["id"] = "next-message"
    with path.open("ab") as fd:
        fd.write(compressor.compress(encode(new_message)))
    second = adapter.watch(str(root), path.name, first.checkpoint)
    assert len(second.entries) == 1 and not second.reset and second.complete


def test_dsh_compressed_frames_and_incremental_follow(tmp_path):
    path = tmp_path / "session.v4.jsonl.zstd"
    compressor = zstandard.ZstdCompressor()
    header = {"type": "session", "version": 4, "id": "dsh-native", "cwd": "/fixture"}
    prompt = {
        "type": "user/message",
        "seq": 1,
        "time": 1793527200000,
        "data": {"content": [{"type": "text", "text": "hello"}]},
    }
    path.write_bytes(compressor.compress(encode(header, prompt)))
    adapter = get_adapter("dsh")
    first = adapter.read_history(str(tmp_path), path.name, {})
    assert first.info.native_id == "dsh-native" and first.entries[0].text == "hello"
    answer = {
        "type": "assistant/message",
        "seq": 2,
        "data": {"message": {"role": "assistant", "content": [{"type": "text", "text": "world"}]}},
    }
    with path.open("ab") as fd:
        fd.write(compressor.compress(encode(answer)))
    second = adapter.watch(str(tmp_path), path.name, first.checkpoint)
    assert len(second.entries) == 1 and second.entries[0].text == "world"
    assert not second.reset


async def test_dsh_normalization_upgrade_backfills_error_without_clearing_history(
    store, tmp_path, monkeypatch
):
    from app.capabilities.agents.sessions import files, parsers

    sessions, client = store
    records = [
        {"type": "session", "version": 4, "id": "dsh-upgrade", "cwd": "/fixture"},
        {"type": "user/message", "seq": 1, "data": {"content": "hello"}},
        {"type": "assistant/message", "seq": 2, "data": {"content": "previous reply"}},
        {
            "type": "turn/end",
            "seq": 3,
            "data": {
                "reason": {
                    "kind": "error",
                    "error": {
                        "code": "MISSING_CREDENTIAL",
                        "message": "credential unavailable",
                        "headers": {"Authorization": "must-not-be-projected"},
                    },
                }
            },
        },
    ]
    path = tmp_path / "session.jsonl.zstd"
    path.write_bytes(zstandard.ZstdCompressor().compress(encode(*records)))
    original = path.read_bytes()
    await bind(client, tmp_path, "dsh")
    original_parser = parsers.dsh

    def legacy_parser(record, *args):
        return [] if record.get("type") == "turn/end" else original_parser(record, *args)

    with monkeypatch.context() as old:
        old.setattr(files, "NORMALIZATION_VERSION", 0)
        old.setattr(parsers, "dsh", legacy_parser)
        await scan(WorkbenchSyncRunner(sessions))
    item = (await client.get("/v1/agent-workbench/sessions")).json()["items"][0]
    url = f"/v1/agent-workbench/sessions/{item['id']}/history"
    assert len((await client.get(url)).json()["items"]) == 2
    monkeypatch.setattr(files, "MAX_CHUNK", 1)
    await scan(WorkbenchSyncRunner(sessions))
    assert len((await client.get(url)).json()["items"]) == 2
    for _ in range(5):
        await scan(WorkbenchSyncRunner(sessions))
    history = (await client.get(url)).json()["items"]
    assert [entry["text"] for entry in history] == [
        "hello",
        "previous reply",
        "MISSING_CREDENTIAL: credential unavailable",
    ]
    assert history[-1]["kind"] == "error"
    assert path.read_bytes() == original


def test_opencode_sqlite_readonly_snapshot_and_in_place_updates(tmp_path):
    path = tmp_path / "opencode.db"
    with sqlite3.connect(path) as db:
        db.executescript(
            "CREATE TABLE session(id TEXT PRIMARY KEY,title TEXT,directory TEXT,"
            "time_updated INTEGER);"
            "CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,"
            "time_created INTEGER,data TEXT);"
            "CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,"
            "time_created INTEGER,data TEXT);"
        )
        db.execute("INSERT INTO session VALUES ('s','fixture','/fixture',1000)")
        db.execute(
            "INSERT INTO message VALUES ('m','s',1000,?)", (json.dumps({"role": "assistant"}),)
        )
        db.execute(
            "INSERT INTO part VALUES ('p','m','s',1000,?)",
            (json.dumps({"type": "text", "text": "first"}),),
        )
    original = path.read_bytes()
    adapter = get_adapter("opencode")
    locator = adapter.discover(str(tmp_path))[0]
    first = adapter.read_history(str(tmp_path), locator, {})
    assert first.entries[0].text == "first" and path.read_bytes() == original
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE part SET data=? WHERE id='p'",
            (json.dumps({"type": "text", "text": "stream updated"}),),
        )
    second = adapter.watch(str(tmp_path), locator, first.checkpoint)
    assert second.entries[0].native_id == "p" and second.entries[0].text == "stream updated"


async def test_cas_pause_unbind_clear_and_event_replay(store, tmp_path):
    sessions, client = store
    root = tmp_path / "sessions"
    root.mkdir()
    (root / "record.jsonl").write_bytes(encode(*codex_records()))
    source = await bind(client, root)
    runner = WorkbenchSyncRunner(sessions)
    await scan(runner)
    item = (await client.get("/v1/agent-workbench/sessions")).json()["items"][0]
    copy_url = f"/v1/agent-workbench/sessions/{item['id']}/copy?expected_revision=0"
    assert (await client.delete(copy_url)).status_code == 409
    url = f"/v1/agent-workbench/sources/{source['id']}"
    pause = await client.patch(url, json={"expected_revision": 0, "enabled": False})
    assert pause.status_code == 200
    assert (
        await client.patch(url, json={"expected_revision": 0, "enabled": True})
    ).status_code == 409
    assert (await client.patch(url, json={"enabled": True})).status_code == 422
    async with sessions() as db:
        bind_owner(db, "alpha")
        checkpoint = await db.scalar(select(WorkbenchCheckpoint))
        batch = get_adapter("codex").read_history(str(root), "record.jsonl", {})
        assert not await apply_batch(
            sessions, source["id"], "alpha", 0, "record.jsonl", checkpoint.state, batch
        )
        events = await event_page(db, "alpha", 0)
        assert any(event["session_id"] == item["id"] for event in events)
        assert await event_page(db, "beta", 0) == []
        assert (await event_page(db, "alpha", 10**9))[0]["kind"] == "reset"
    assert (await client.delete(url + "?expected_revision=1")).status_code == 204
    assert (await client.get("/v1/agent-workbench/sources")).json() == []
    assert (
        await client.get(f"/v1/agent-workbench/sessions/{item['id']}/history")
    ).status_code == 200
    assert (await client.delete(copy_url)).status_code == 204
    assert (root / "record.jsonl").exists()


async def test_private_desktop_and_session_are_required(store, tmp_path):
    _, client = store
    body = {"agent_id": "codex", "label": "fixture", "root": str(tmp_path)}
    assert (await client.post("/v1/agent-workbench/sources", json=body)).status_code == 403
    assert (await client.get("/v1/agent-workbench/candidates")).status_code == 403
    assert (
        await client.get(
            "/v1/agent-workbench/sources", headers={"x-auth-kind": "management_api_key"}
        )
    ).status_code == 403
    for endpoint in [
        "http://127.0.0.1:invalid",
        "http://[invalid:123",
        "http://example.com:123",
        "http://127.0.0.1:123/path",
        "http://user:secret@127.0.0.1:123",
    ]:
        result = await client.post(
            "/v1/agent-workbench/sources",
            headers={"x-private": "yes"},
            json={"agent_id": "opencode", "label": "fixture", "endpoint": endpoint},
        )
        assert result.status_code == 422


def test_symlinks_are_not_read(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "private.jsonl").write_bytes(encode(*codex_records()))
    root = tmp_path / "root"
    root.mkdir()
    (root / "linked.jsonl").symlink_to(outside / "private.jsonl")
    adapter = get_adapter("codex")
    assert adapter.discover(str(root)) == []
    with pytest.raises(ValueError):
        adapter.read_history(str(root), "linked.jsonl", {})


async def test_attachments_require_actual_reference_owner_and_approved_root(store, tmp_path):
    sessions, client = store
    root = tmp_path / "attachments-source"
    root.mkdir()
    (root / "diagram.txt").write_text("fixture attachment")
    outside = tmp_path / "private.txt"
    outside.write_text("not in allowed root")
    records = codex_records()
    records[1]["payload"]["content"].extend(
        [
            {"type": "file", "path": str(root / "diagram.txt")},
            {"type": "file", "path": str(outside)},
        ]
    )
    (root / "record.jsonl").write_bytes(encode(*records))
    await bind(client, root)
    await scan(WorkbenchSyncRunner(sessions))
    item = (await client.get("/v1/agent-workbench/sessions")).json()["items"][0]
    history = (await client.get(f"/v1/agent-workbench/sessions/{item['id']}/history")).json()
    attachments = [a for entry in history["items"] for a in entry["attachments"]]
    assert len(attachments) == 2 and all("reference" not in a for a in attachments)
    url = f"/v1/agent-workbench/sessions/{item['id']}/attachments/"
    readable = next(a for a in attachments if a["name"] == "diagram.txt")
    forbidden = next(a for a in attachments if a["name"] == "private.txt")
    assert (await client.get(url + readable["id"])).text == "fixture attachment"
    assert (await client.get(url + forbidden["id"])).status_code == 404
    assert (await client.get(url + readable["id"], headers={"x-owner": "beta"})).status_code == 404
    (root / "diagram.txt").unlink()
    (root / "diagram.txt").symlink_to(outside)
    assert (await client.get(url + readable["id"])).status_code == 404


async def test_archive_duplicates_and_same_inode_rewrite(store, tmp_path):
    sessions, client = store
    root = tmp_path / "codex-home"
    active = root / "sessions"
    archive = root / "archived_sessions"
    active.mkdir(parents=True)
    archive.mkdir()
    path = active / "current.jsonl"
    records = codex_records()
    (root / "session_index.jsonl").write_bytes(
        encode({"id": "native", "thread_name": "index only", "updated_at": "2026-11-01"})
    )
    path.write_bytes(encode(*records))
    (archive / "copy.jsonl").write_bytes(encode(*records))
    await bind(client, root)
    runner = WorkbenchSyncRunner(sessions)
    await scan(runner)
    assert (await client.get("/v1/agent-workbench/sources")).json()[0]["status"] == "following"
    items = (await client.get("/v1/agent-workbench/sessions")).json()["items"]
    assert len(items) == 1 and not items[0]["archived"]
    url = f"/v1/agent-workbench/sessions/{items[0]['id']}/history"
    old = (await client.get(url)).json()
    # The source rewrites in place and remains the same size; the prefix detects it.
    changed = encode(*records).replace(b"searchable", b"rewritten!")
    path.write_bytes(changed)
    await scan(runner)
    new = (await client.get(url)).json()
    assert any("rewritten!" in e["text"] for e in new["items"])
    assert new["change_cursor"] > old["change_cursor"]


async def test_stream_reauthorizes_after_session_revocation(store):
    from datetime import timedelta

    from app.apps.agent_workbench.events import stream_events
    from app.console.models import AuthSession
    from app.runtime.time import utc_now

    sessions, _ = store
    async with sessions() as db:
        db.add(
            AuthSession(
                id="stream-session",
                user_id="alpha",
                token_hash="fixture-hash",
                csrf_hash="fixture-csrf",
                idle_expires_at=utc_now() + timedelta(hours=1),
                absolute_expires_at=utc_now() + timedelta(hours=1),
            )
        )
        await db.commit()
    principal = StudioPrincipal(
        user_id="alpha",
        platform_role="user",
        auth_kind="session",
        must_change_password=False,
        scopes=frozenset({"studio:read"}),
        session_id="stream-session",
    )

    class ConnectedRequest:
        async def is_disconnected(self):
            return False

    stream = stream_events(ConnectedRequest(), principal, 0, sessions=sessions)
    assert "connected" in await anext(stream)
    assert "heartbeat" in await anext(stream)
    async with sessions() as db:
        row = await db.get(AuthSession, "stream-session")
        row.revoked_at = utc_now()
        await db.commit()
    assert "auth_expired" in await anext(stream)
    await stream.aclose()


def test_opencode_server_is_readonly_and_preserves_native_message_ids(monkeypatch):
    from app.capabilities.agents.sessions.opencode import OpenCodeServerAdapter

    calls = []
    answer = {"value": "initial"}

    def respond(request):
        calls.append((request.method, request.url.path))
        if request.url.path == "/global/health":
            data = {"healthy": True, "version": "fixture"}
        elif request.url.path == "/session":
            data = [{"id": "native-http"}]
        elif request.url.path.endswith("/message"):
            data = [
                {
                    "info": {"id": "m", "role": "assistant", "time": {"created": 1000}},
                    "parts": [{"id": "p", "type": "text", "text": answer["value"]}],
                }
            ]
        else:
            data = {
                "id": "native-http",
                "directory": "/fixture",
                "title": "fixture",
                "time": {"updated": 1000},
            }
        return httpx.Response(200, json=data)

    original = httpx.Client
    monkeypatch.setattr(
        httpx, "Client", lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs)
    )
    adapter = OpenCodeServerAdapter("http://127.0.0.1:1111")
    assert adapter.discover("") == ["native-http"]
    first = adapter.read_history("", "native-http", {})
    answer["value"] = "updated"
    second = adapter.watch("", "native-http", first.checkpoint)
    assert first.entries[0].native_id == second.entries[0].native_id == "p"
    assert second.entries[0].text == "updated"
    assert all(method == "GET" for method, _ in calls)


async def test_missing_native_file_retains_copy_and_recovers(store, tmp_path):
    sessions, client = store
    root = tmp_path / "missing-source"
    root.mkdir()
    path = root / "record.jsonl"
    data = encode(*codex_records())
    path.write_bytes(data)
    await bind(client, root)
    runner = WorkbenchSyncRunner(sessions)
    await scan(runner)
    item = (await client.get("/v1/agent-workbench/sessions")).json()["items"][0]
    url = f"/v1/agent-workbench/sessions/{item['id']}"
    path.unlink()
    await scan(runner)
    missing = (await client.get(url)).json()
    assert "已消失" in missing["source_errors"][0]
    assert len((await client.get(url + "/history")).json()["items"]) == 2
    path.write_bytes(data)
    await scan(runner)
    assert (await client.get(url)).json()["source_errors"] == []


def test_workbench_does_not_expand_agent_or_sdk_operation_surface():
    root = Path(__file__).resolve().parents[1]
    mapping = json.loads((root / "sdk/python/operations.json").read_text())
    operations = json.loads(
        (root / "backend/app/console/governance/automation_operations.json").read_text()
    )["operations"]
    assert not any("/agent-workbench/" in key for key in mapping)
    assert not any("/agent-workbench/" in key for key in operations)


async def test_ten_thousand_metadata_records_paginate_before_history_index(store):
    sessions, client = store
    async with sessions() as db:
        await db.execute(
            insert(WorkbenchSession),
            [
                {
                    "id": f"volume-{index:05}",
                    "owner_user_id": "alpha",
                    "agent_id": "codex",
                    "native_id": f"volume-{index:05}",
                    "title": f"Volume session {index}",
                    "updated_at": "2026-11-01T00:00:00.000Z",
                }
                for index in range(10000)
            ],
        )
        await db.commit()
    first = (await client.get("/v1/agent-workbench/sessions")).json()
    assert len(first["items"]) == 50 and first["next_cursor"]
    second = (
        await client.get("/v1/agent-workbench/sessions", params={"cursor": first["next_cursor"]})
    ).json()
    assert len(second["items"]) == 50
    assert not {item["id"] for item in first["items"]} & {item["id"] for item in second["items"]}
    assert (await client.get("/v1/agent-workbench/sessions?q=Volume%20session%209999")).json()[
        "items"
    ][0]["id"] == "volume-09999"
