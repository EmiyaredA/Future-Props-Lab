"""Code Agent governance and native transports, with isolated accounts and fake CLIs."""

import asyncio
import io
import json
import sys
from contextlib import aclosing
from pathlib import Path

import httpx
import pytest
from sqlalchemy import update

from app.capabilities.agents.cli.catalog import connection, inspect_connection
from app.capabilities.agents.cli.codex_profile import profile_path
from app.console.governance.code_agents import resolve_connection
from studio.apps.amadeus.storage.models import AmadeusConversation
from studio.assembly.website.models import bind_owner
from studio.config.settings import get_settings
from studio.runtime.database.operation_receipts import OperationError
from test_workspace_governance import client_account
from website_test_support import SessionLocal, app

pytestmark = pytest.mark.real_auth


def fake_cli(root: Path, name="fake"):
    path = root / name
    path.write_text(
        f"#!{sys.executable}\n"
        + """
import sys, json, os, subprocess, re

if "--version" in sys.argv:
    print("fake 2.163.300")
    raise SystemExit
if sys.argv[-2:] in (["login", "status"], ["auth", "status"]):
    raise SystemExit
assert "FPL_SECRETS_KEY" not in os.environ
assert "FPL_STUDIO_TOKEN" not in os.environ


def send(x):
    print(json.dumps(x), flush=True)


if "app-server" in sys.argv:
    assert os.environ["CODEX_HOME"].endswith("/profiles/codex-app-server")
    assert "features.shell_tool=false" in sys.argv
    assert 'sandbox_mode="read-only"' in sys.argv
    for line in sys.stdin:
        x = json.loads(line)
        method = x.get("method")
        if method == "initialize":
            send({"id": x["id"], "result": {}})
        elif method == "config/read":
            send({"id": x["id"], "result": {"config": {
                "sandbox_mode": "read-only",
                "approval_policy": "never",
                "web_search": "disabled",
                "cli_auth_credentials_store": "file",
                "features": {
                    "skip_host_skill_discovery": True,
                    "shell_tool": False,
                    "hooks": False,
                    "plugins": False,
                    "apps": False,
                    "multi_agent": False,
                    "skill_search": False,
                },
            }}})
        elif method == "model/list":
            send(
                {
                    "id": x["id"],
                    "result": {"data": [{"model": "fake-model", "displayName": "Fake model"}]},
                }
            )
        elif method == "thread/start":
            assert x["params"]["ephemeral"]
            assert os.getcwd() == x["params"]["cwd"]
            assert os.path.basename(os.getcwd()).startswith("fpl-codex-work-")
            send({"id": x["id"], "result": {"thread": {"id": "fake-thread"}}})
        elif method == "turn/start":
            send({"id": x["id"], "result": {"turn": {"id": "fake-turn"}}})
            prompt = x["params"]["input"][0]["text"]
            try:
                history = json.loads(prompt.splitlines()[1])["messages"]
                marker = next(m["content"] for m in reversed(history) if m["role"] == "user")
            except (ValueError, KeyError, StopIteration):
                marker = prompt
            if "BIG_FAKE" in marker:
                send({"method": "item/agentMessage/delta", "params": {"delta": "x" * 100001}})
                send({"method": "turn/completed", "params": {"turn": {"status": "completed"}}})
                break
            if "SLOW_FAKE" in marker:
                import time
                send({"method": "item/agentMessage/delta", "params": {"delta": "正在运行"}})
                time.sleep(60)
            tool = (
                "ask_user"
                if "ASK_FAKE" in marker
                else "write_file"
                if "WRITE_FAKE" in marker
                else "operations"
            )
            args = (
                {"prompt": "Which one?", "options": ["A", "B"]}
                if tool == "ask_user"
                else {"name": "draft.txt", "content": "draft"}
                if tool == "write_file"
                else {}
            )
            draft = re.search(r"DRAFT_FAKE:([a-f0-9-]+):(OLD|NEW)", marker)
            if draft:
                tool = "call"
                project_id, version = draft.groups()
                args = {"operation": "visual.apply_canvas_operations", "arguments": {
                    "path_params": {"project_id": project_id},
                    "body": {"expected_revision": 0, "request_id": "draft-" + version,
                        "operations": [{"entity": "node", "action": "insert", "id": "video-draft",
                            "value": {"id": "video-draft", "kind": "video",
                                "title": "旧标题" if version == "OLD" else "新标题",
                                "position": {"x": 80, "y": 120},
                                "generation_draft": {"prompt": "日落城市镜头"}}}]}}}
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
    profile = profile_path(settings.runtime_path)
    profile.mkdir(mode=0o700, parents=True, exist_ok=True)
    auth = profile / "auth.json"
    auth.touch(mode=0o600)
    for prefix in ("codex", "claude"):
        monkeypatch.setattr(settings, f"fpl_code_agents_{prefix}_enabled", True)
        monkeypatch.setattr(settings, f"fpl_code_agents_{prefix}_executable", binary)
    monkeypatch.setattr(app.state, "desktop_enabled", True, raising=False)
    yield binary
    # Waiting-for-owner is persisted before transport teardown completes. The
    # server lifespan normally drains these tasks; each test owns a fresh loop.
    await app.state.code_agent_runs.close()


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured")
async def test_codex_startup_failure_does_not_hide_other_agents(tmp_path, monkeypatch):
    binary = tmp_path / "broken-codex"
    binary.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        "if '--version' in sys.argv: print('codex-cli 0.166.0')\n"
        "raise SystemExit(2 if 'app-server' in sys.argv else 0)\n"
    )
    binary.chmod(0o700)
    monkeypatch.setattr(get_settings(), "fpl_code_agents_codex_executable", str(binary))
    client, _, _, _ = await client_account(admin=True)
    async with aclosing(client):
        for response in (
            await client.get("/v1/code-agents"),
            await client.post("/v1/code-agents/detect"),
        ):
            assert response.status_code == 200
            agents = {item["id"]: item for item in response.json()["items"]}
            assert agents["codex"]["status"] == "probe_failed"
            assert not agents["codex"]["available"]
            assert agents["codex"]["models"] == []
            assert agents["claude-code"]["available"]
    status = await inspect_connection(get_settings(), "codex", discover_models=False)
    assert not status["available"] and status["status"] == "probe_failed"
    with pytest.raises(OperationError) as failure:
        await resolve_connection("codex")
    assert failure.value.code == "probe_failed"


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured")
async def test_codex_model_discovery_failure_preserves_dialogue_readiness(tmp_path, monkeypatch):
    binary = Path(fake_cli(tmp_path, "missing-model-list"))
    binary.write_text(binary.read_text().replace('"data": [{"model":', '"unexpected": [{"model":'))
    settings = get_settings()
    monkeypatch.setattr(settings, "fpl_code_agents_codex_executable", str(binary))

    result = await inspect_connection(settings, "codex")
    assert result["available"] and result["status"] == "ready"
    assert result["models"] == []
    assert await resolve_connection("codex") == str(binary)


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
@pytest.mark.usefixtures("configured")
async def test_cli_defaults_for_active_accounts_and_preserves_owner_boundary():
    admin, _, admin_id, _ = await client_account(admin=True)
    regular, _, user_id, _ = await client_account()
    from app.console.governance.code_agents import authorized

    async with aclosing(admin), aclosing(regular):
        result = await regular.get("/v1/code-agents")
        assert result.status_code == 200
        assert not result.json()["can_enable"]
        codex = next(item for item in result.json()["items"] if item["id"] == "codex")
        assert codex["available"]
        assert not codex["executable"]
        assert (await regular.post("/v1/code-agents/codex/enable")).status_code == 403
        assert (await regular.get("/v1/cloud-control/status")).status_code == 403
        assert (
            await regular.post("/v1/cloud-control/desktop/connect", json={"password": "fixture"})
        ).status_code == 403
        async with SessionLocal() as session:
            assert await authorized(session, admin_id, admin_id, "codex", "amadeus")
            assert await authorized(session, user_id, user_id, "codex", "visual_acceptance")
            assert await authorized(session, user_id, user_id, "codex", "interview_preparation")
            assert not await authorized(
                session, user_id, user_id, "claude-code", "interview_preparation"
            )
            assert not await authorized(session, admin_id, user_id, "codex", "amadeus")


@pytest.mark.usefixtures("configured")
async def test_cli_host_paths_and_enable_require_local_admin(tmp_path, monkeypatch):
    admin, *_ = await client_account(admin=True)
    regular, *_ = await client_account()
    enabled = []
    claude = tmp_path / "claude"
    logged_in = tmp_path / "claude-logged-in"
    claude.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        "from pathlib import Path\n"
        "if '--version' in sys.argv: print('Claude Code 2.1.259')\n"
        f"elif not Path({str(logged_in)!r}).exists(): raise SystemExit(1)\n"
    )
    claude.chmod(0o700)
    settings = get_settings()
    monkeypatch.setattr(settings, "fpl_code_agents_claude_enabled", False)
    monkeypatch.setattr(settings, "fpl_code_agents_claude_executable", str(claude))
    for identity in ("opencode", "dsh", "pi"):
        monkeypatch.setattr(
            settings, f"fpl_code_agents_{identity}_executable", str(tmp_path / identity)
        )

    async def enable(_request, agent_id):
        enabled.append(agent_id)

    async def local(scope, receive, send):
        scope["state"] = {"website_local": True}
        await app(scope, receive, send)

    monkeypatch.setattr(app.state, "code_agent_enable", enable)
    async with aclosing(admin), aclosing(regular):
        public_catalog = (await admin.get("/v1/code-agents")).json()
        assert not public_catalog["can_enable"]
        assert not any(item["executable"] for item in public_catalog["items"])
        public_claude = next(
            item for item in public_catalog["items"] if item["id"] == "claude-code"
        )
        assert public_claude["status"] == "disabled"
        assert not public_claude["version"]
        assert (await admin.post("/v1/code-agents/codex/enable")).status_code == 403
        for client, can_enable in ((regular, False), (admin, True)):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(local),
                base_url="http://test",
                headers=client.headers,
                cookies=client.cookies,
            ) as browser:
                local_catalog = (await browser.get("/v1/code-agents")).json()
                assert local_catalog["can_enable"] is can_enable
                assert any(item["executable"] for item in local_catalog["items"]) is can_enable
                local_claude = next(
                    item for item in local_catalog["items"] if item["id"] == "claude-code"
                )
                assert not local_claude["enabled"]
                assert not local_claude["available"]
                assert local_claude["status"] == ("not_authenticated" if can_enable else "disabled")
                if can_enable:
                    assert local_claude["version"] == "2.1.259"
                    logged_in.touch()
                    response = await browser.post("/v1/code-agents/detect")
                    assert response.status_code == 200, response.text
                    checked = next(
                        item for item in response.json()["items"] if item["id"] == "claude-code"
                    )
                    assert checked["status"] == "ready_to_enable"
                    assert not checked["enabled"]
                    assert not checked["available"]
                    assert not settings.fpl_code_agents_claude_enabled
                response = await browser.post("/v1/code-agents/codex/enable")
                assert response.status_code == (204 if can_enable else 403), response.text
    assert enabled == ["codex"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "marker,status", [("WRITE_FAKE", "waiting_approval"), ("ASK_FAKE", "waiting_question")]
)
async def test_tools_pause_for_owner_and_reject_plan_writes(configured, marker, status):
    assert configured
    client, _, user_id, _ = await client_account(admin=True)
    async with aclosing(client):
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
