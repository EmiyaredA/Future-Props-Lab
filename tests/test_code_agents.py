"""Code Agent governance and native transports, with isolated accounts and fake CLIs."""

import asyncio
import io
import json
import sys
from contextlib import aclosing
from pathlib import Path

import pytest
from sqlalchemy import update

from app.capabilities.agents.cli.catalog import connection, inspect_connection
from app.console.amadeus.models import AmadeusConversation
from app.main import app
from app.orm import bind_owner
from app.runtime.config import get_settings
from app.runtime.db import SessionLocal
from test_workspace_governance import client_account

pytestmark = pytest.mark.real_auth


def fake_cli(root: Path, name="fake"):
    path = root / name
    path.write_text(
        f"#!{sys.executable}\n"
        + """
import sys, json, os, subprocess

if "--version" in sys.argv:
    print("fake 2.163.300")
    raise SystemExit
if sys.argv[1:3] in (["login", "status"], ["auth", "status"]):
    raise SystemExit
assert "FPL_SECRETS_KEY" not in os.environ
assert "FPL_STUDIO_TOKEN" not in os.environ


def send(x):
    print(json.dumps(x), flush=True)


if "app-server" in sys.argv:
    assert "features.shell_tool=false" in sys.argv
    for line in sys.stdin:
        x = json.loads(line)
        method = x.get("method")
        if method == "initialize":
            send({"id": x["id"], "result": {}})
        elif method == "model/list":
            send(
                {
                    "id": x["id"],
                    "result": {"data": [{"model": "fake-model", "displayName": "Fake model"}]},
                }
            )
        elif method == "thread/start":
            assert x["params"]["ephemeral"]
            send({"id": x["id"], "result": {"thread": {"id": "fake-thread"}}})
        elif method == "turn/start":
            send({"id": x["id"], "result": {"turn": {"id": "fake-turn"}}})
            prompt = x["params"]["input"][0]["text"]
            if "BIG_FAKE" in prompt:
                send({"method": "item/agentMessage/delta", "params": {"delta": "x" * 100001}})
                send({"method": "turn/completed", "params": {"turn": {"status": "completed"}}})
                break
            if "SLOW_FAKE" in prompt:
                import time
                send({"method": "item/agentMessage/delta", "params": {"delta": "正在运行"}})
                time.sleep(60)
            tool = (
                "ask_user"
                if "ASK_FAKE" in prompt
                else "write_file"
                if "WRITE_FAKE" in prompt
                else "operations"
            )
            args = (
                {"prompt": "Which one?", "options": ["A", "B"]}
                if tool == "ask_user"
                else {"name": "draft.txt", "content": "draft"}
                if tool == "write_file"
                else {}
            )
            send(
                {
                    "id": "tool-1",
                    "method": "item/tool/call",
                    "params": {"tool": tool, "arguments": args},
                }
            )
        elif x.get("id") == "tool-1":
            send({"method": "item/agentMessage/delta", "params": {"delta": "假 CLI 已核对项目"}})
            send({"method": "turn/completed", "params": {"turn": {"status": "completed"}}})
            break
else:
    assert "--restricted" in sys.argv and sys.argv[sys.argv.index("--tools") + 1] == ""
    prompt = sys.stdin.read()
    config = json.loads(sys.argv[sys.argv.index("--mcp-config") + 1])["mcpServers"]["fpl"]
    child = subprocess.Popen(
        [config["command"], *config["args"]],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        env={**os.environ, **config["env"]},
    )
    for identity, method, params in [
        (1, "initialize", {}),
        (2, "tools/list", {}),
        (3, "tools/call", {"name": "operations", "arguments": {}}),
    ]:
        child.stdin.write(
            json.dumps({"jsonrpc": "2.0", "id": identity, "method": method, "params": params})
            + "\\n"
        )
        child.stdin.flush()
        result = json.loads(child.stdout.readline())
        assert "result" in result and not result["result"].get("isError")
    child.stdin.close()
    child.wait(timeout=10)
    send(
        {
            "type": "stream_event",
            "event": {"delta": {"type": "text_delta", "text": "假 Claude 已核对项目"}},
        }
    )
    send({"type": "result", "subtype": "success", "is_error": False})
"""
    )
    path.chmod(0o700)
    return str(path)


@pytest.fixture
async def configured(tmp_path, monkeypatch):
    settings = get_settings()
    binary = fake_cli(tmp_path)
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "codex-home"))
    monkeypatch.setenv("FPL_SECRETS_KEY", "not-for-cli")
    for prefix in ("codex", "claude"):
        monkeypatch.setattr(settings, f"fpl_code_agents_{prefix}_enabled", True)
        monkeypatch.setattr(settings, f"fpl_code_agents_{prefix}_executable", binary)
    monkeypatch.setattr(app.state, "desktop_enabled", True, raising=False)
    yield binary
    # Waiting-for-owner is persisted before transport teardown completes. The
    # server lifespan normally drains these tasks; each test owns a fresh loop.
    await app.state.code_agent_runs.close()


async def authorize(client, user_id, agent="codex", purpose="amadeus"):
    state = (await client.get("/v1/code-agents/grants")).json()
    response = await client.put(
        "/v1/code-agents/grants",
        json={
            "expected_revision": state["revision"],
            "managed": list(set([*state["managed"], f"{agent}:{purpose}"])),
            "grants": [
                *state["grants"],
                {"user_id": user_id, "agent_id": agent, "purpose": purpose},
            ],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def wait_run(client, root, identity):
    for _ in range(150):
        value = (await client.get(f"{root}/runs/{identity}")).json()
        if value["run"]["status"] not in {"running", "cancelling"}:
            return value
        await asyncio.sleep(0.05)
    raise AssertionError("Fake run did not settle")


@pytest.mark.asyncio
@pytest.mark.parametrize("agent", ["codex", "claude-code"])
async def test_backend_owned_native_run_and_event_tombstones(configured, agent):
    assert configured
    client, _, user_id, _ = await client_account(admin=True)
    async with aclosing(client):
        await authorize(client, user_id, agent)
        status = (await client.get("/v1/code-agents")).json()
        assert next(a for a in status["items"] if a["id"] == agent)["available"]
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        await client.post(
            root + "/messages",
            json={"role": "user", "content": "读取项目目录", "expected_revision": 0},
        )
        started = await client.post(root + "/runs", json={"agent_id": agent})
        assert started.status_code == 200, started.text
        identity = started.json()["run"]["id"]
        assert (
            await client.post(root + f"/runs/{identity}/finish", json={"status": "completed"})
        ).status_code == 410
        result = await wait_run(client, root, identity)
        assert result["run"]["status"] == "completed", (
            result["run"]["error_message"],
            result["events"],
        )
        assert "已核对项目" in result["run"]["partial_text"]
        sequences = [e["sequence"] for e in result["events"]]
        assert sequences == sorted(set(sequences))
        changed = await client.post(
            root + "/runs", json={"agent_id": "claude-code" if agent == "codex" else "codex"}
        )
        assert changed.status_code == 409
        assert (await client.get(root)).json()["messages"][-1]["run_id"] == identity


@pytest.mark.asyncio
async def test_grants_cas_purpose_scope_and_legacy_takeover(configured, monkeypatch):
    assert configured
    client, _, user_id, owner_user_id = await client_account(admin=True)
    other, _, other_id, other_workspace = await client_account()
    async with aclosing(client), aclosing(other):
        state = await authorize(client, user_id)
        stale = await client.put(
            "/v1/code-agents/grants",
            json={"expected_revision": 0, "managed": state["managed"], "grants": []},
        )
        assert stale.status_code == 409
        missing = await client.put("/v1/code-agents/grants", json={"managed": [], "grants": []})
        assert missing.status_code == 422
        assert (await other.get("/v1/code-agents/grants")).status_code == 403
        bad = await client.put(
            "/v1/code-agents/grants",
            json={
                "expected_revision": state["revision"],
                "managed": state["managed"],
                "grants": [{"user_id": other_id, "agent_id": "codex", "purpose": "amadeus"}],
            },
        )
        assert bad.status_code == 200
        from app.console.governance.code_agents import authorized

        async with SessionLocal() as session:
            assert not await authorized(session, owner_user_id, user_id, "codex", "amadeus")
            assert await authorized(session, other_id, other_id, "codex", "amadeus")
            assert not await authorized(session, other_workspace, user_id, "codex", "amadeus")
            assert not await authorized(
                session, owner_user_id, user_id, "codex", "interview_preparation"
            )
        monkeypatch.setattr(get_settings(), "fpl_acceptance_codex_user_ids", user_id)
        state = await authorize(client, user_id, purpose="visual_acceptance")
        revoked = await client.put(
            "/v1/code-agents/grants",
            json={
                "expected_revision": state["revision"],
                "managed": state["managed"],
                "grants": [],
            },
        )
        assert revoked.status_code == 200
        async with SessionLocal() as session:
            assert not await authorized(
                session, owner_user_id, user_id, "codex", "visual_acceptance"
            )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "marker,status", [("WRITE_FAKE", "waiting_approval"), ("ASK_FAKE", "waiting_question")]
)
async def test_tools_pause_for_owner_and_reject_plan_writes(configured, marker, status):
    assert configured
    client, _, user_id, _ = await client_account(admin=True)
    async with aclosing(client):
        await authorize(client, user_id)
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        await client.post(
            root + "/messages", json={"expected_revision": 0, "role": "user", "content": marker}
        )
        started = (await client.post(root + "/runs", json={"agent_id": "codex"})).json()
        result = await wait_run(client, root, started["run"]["id"])
        assert result["run"]["status"] == status, result
        detail = (await client.get(root)).json()
        if marker == "WRITE_FAKE":
            action = detail["actions"][0]
            approved = await client.post(
                root + f"/actions/{action['id']}/decision",
                json={"approve": True, "arguments_sha256": action["arguments_sha256"]},
            )
            assert approved.status_code == 200
            executed = await client.post(root + f"/actions/{action['id']}/execute")
            assert executed.status_code == 200, executed.text
            assert executed.json()["status"] == "completed"
            assert (await client.post(root + f"/actions/{action['id']}/execute")).status_code == 409
        else:
            question = detail["questions"][0]
            answered = await client.post(
                root + f"/questions/{question['id']}/answer", json={"answer": "A"}
            )
            assert answered.status_code == 200


@pytest.mark.asyncio
async def test_old_history_stays_readonly(configured):
    assert configured
    client, _, user_id, owner_user_id = await client_account(admin=True)
    async with aclosing(client):
        await authorize(client, user_id)
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        async with SessionLocal() as session:
            bind_owner(session, owner_user_id)
            await session.execute(
                update(AmadeusConversation)
                .where(AmadeusConversation.id == conversation["id"])
                .values(executor_kind="legacy-pi")
            )
            await session.commit()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        assert (await client.get(root)).status_code == 200
        assert (await client.post(root + "/runs", json={"agent_id": "codex"})).status_code == 409
        assert (
            await client.post(
                root + "/messages",
                json={"expected_revision": 0, "role": "user", "content": "不要执行"},
            )
        ).status_code == 409


@pytest.mark.asyncio
async def test_native_cancel_stops_process_and_plan_cannot_propose_writes(configured):
    assert configured
    client, _, user_id, _ = await client_account(admin=True)
    async with aclosing(client):
        await authorize(client, user_id)
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        await client.post(
            root + "/messages",
            json={"expected_revision": 0, "role": "user", "content": "SLOW_FAKE"},
        )
        started = (await client.post(root + "/runs", json={"agent_id": "codex"})).json()
        identity = started["run"]["id"]
        for _ in range(100):
            value = (await client.get(root + f"/runs/{identity}")).json()
            if value["run"]["partial_text"]:
                break
            await asyncio.sleep(0.05)
        cancelled = await client.post(root + f"/runs/{identity}/cancel")
        assert cancelled.status_code == 200, cancelled.text
        assert (await wait_run(client, root, identity))["run"]["status"] == "cancelled"
        assert identity not in app.state.code_agent_runs.tasks
        other = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{other['id']}"
        await client.post(
            root + "/messages",
            json={"expected_revision": 0, "role": "user", "content": "WRITE_FAKE"},
        )
        started = (
            await client.post(root + "/runs", json={"agent_id": "codex", "mode": "plan"})
        ).json()
        result = await wait_run(client, root, started["run"]["id"])
        assert any(
            e["kind"] == "tool_result" and e["payload"]["status"] == "failed"
            for e in result["events"]
        )
        assert (await client.get(root)).json()["actions"] == []


def test_external_mcp_stdio_and_unknown_tool():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sdk/python/src"))
    from future_props_lab.mcp import external_tools, serve

    requests = [
        {"id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}},
        {"id": 2, "method": "tools/list"},
        {"id": 3, "method": "tools/call", "params": {"name": "operations", "arguments": {}}},
        {"id": 4, "method": "tools/call", "params": {"name": "shell", "arguments": {}}},
    ]
    target = io.StringIO()
    serve(
        lambda _name, _args: {"operations": ["visual.list_projects"]},
        external_tools(),
        input_stream=io.StringIO("\n".join(json.dumps(r) for r in requests)),
        output_stream=target,
    )
    responses = [json.loads(line) for line in target.getvalue().splitlines()]
    assert responses[0]["result"]["capabilities"] == {"tools": {}}
    assert {t["name"] for t in responses[1]["result"]["tools"]} == {"operations", "call", "open"}
    assert "visual.list_projects" in responses[2]["result"]["content"][0]["text"]
    assert "error" in responses[3]


def test_mcp_distinguishes_api_lists_from_explicit_content_blocks():
    from future_props_lab.mcp import external_tools, serve

    request = json.dumps({"id": 1, "method": "tools/call", "params": {"name": "call"}})
    projects = [{"id": "project", "title": "示例项目"}]
    target = io.StringIO()
    serve(
        lambda _name, _args: projects,
        external_tools(),
        input_stream=io.StringIO(request),
        output_stream=target,
    )
    content = json.loads(target.getvalue())["result"]["content"]
    assert content[0]["type"] == "text"
    assert json.loads(content[0]["text"]) == projects

    image = [{"type": "image", "mimeType": "image/png", "data": "aGVsbG8="}]
    target = io.StringIO()
    serve(
        lambda _name, _args: image,
        external_tools(),
        input_stream=io.StringIO(request),
        output_stream=target,
        content_blocks=True,
    )
    assert json.loads(target.getvalue())["result"]["content"] == image


@pytest.mark.asyncio
async def test_probe_config_precedence_and_bad_executable(configured, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "fpl_acceptance_codex_executable", "/a")
    monkeypatch.setattr(settings, "fpl_interview_codex_executable", "/b")
    assert connection(settings, "codex")[1] == configured
    monkeypatch.setattr(settings, "fpl_code_agents_codex_executable", "")
    assert "冲突" in connection(settings, "codex")[2]
    monkeypatch.setattr(settings, "fpl_code_agents_codex_executable", "/does-not-exist")
    assert (await inspect_connection(settings, "codex"))["status"] == "not_installed"


@pytest.mark.asyncio
async def test_oversized_reply_fails_without_stranding_the_owner(configured):
    assert configured
    client, _, user_id, _ = await client_account(admin=True)
    async with aclosing(client):
        await authorize(client, user_id)
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        await client.post(
            root + "/messages", json={"expected_revision": 0, "role": "user", "content": "BIG_FAKE"}
        )
        started = (await client.post(root + "/runs", json={"agent_id": "codex"})).json()
        result = await wait_run(client, root, started["run"]["id"])
        assert result["run"]["status"] == "failed"
        assert (await client.get("/v1/amadeus/runs/active")).json() is None


def test_binary_tool_results_are_not_duplicated_into_persistent_events():
    from app.capabilities.agents.cli.conversation import recorded_result

    image = [{"type": "image", "mimeType": "image/png", "data": "A" * (1024 * 1024)}]
    event = recorded_result(image)
    assert "data" not in event[0]
    assert event[0]["bytes"] > 0
    assert len(json.dumps(event)) < 1024
    assert image[0]["data"] == "A" * (1024 * 1024)
