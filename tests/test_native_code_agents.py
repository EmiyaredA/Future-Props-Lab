"""Native CLI adapters run through real subprocesses and the FPL task bridge."""

import asyncio
import json
import os
import shutil
import sys
from contextlib import aclosing
from pathlib import Path

import pytest

from app.capabilities.agents.cli.isolation import dsh_connection_patches, launch
from app.capabilities.agents.cli.native import converse
from app.capabilities.agents.cli.process import execute
from app.capabilities.agents.cli.transport import CliError
from app.main import app
from app.runtime.config import get_settings
from test_code_agents import wait_run
from test_workspace_governance import client_account

pytestmark = pytest.mark.real_auth
NATIVE = ("opencode", "dsh", "pi")


@pytest.fixture
async def native_cli(tmp_path, monkeypatch):
    source = Path(__file__).parent / "fixtures/native_code_agents.py"
    executable = tmp_path / "fake-native"
    executable.write_text(f"#!{sys.executable}\n" + source.read_text())
    executable.chmod(0o700)
    settings = get_settings()
    for kind in NATIVE:
        monkeypatch.setattr(settings, f"fpl_code_agents_{kind}_enabled", True)
        monkeypatch.setattr(settings, f"fpl_code_agents_{kind}_executable", str(executable))
    monkeypatch.setattr(app.state, "desktop_enabled", True, raising=False)
    home = tmp_path / "dsh-home"
    home.mkdir()
    (home / ".credentials.yaml").write_text("fixture: not-a-real-credential")
    monkeypatch.setenv("DSH_HOME", str(home))
    monkeypatch.setenv("PI_CODING_AGENT_DIR", str(tmp_path / "pi-home"))
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-be-inherited")
    monkeypatch.setenv("FPL_STUDIO_TOKEN", "must-not-be-inherited")
    yield str(executable)
    await app.state.code_agent_runs.close()


@pytest.mark.parametrize("kind", NATIVE)
async def test_native_amadeus_calls_backend_tools_and_records_events(native_cli, kind):
    assert native_cli
    client, _, user_id, _ = await client_account(admin=True)
    async with aclosing(client):
        catalog = (await client.get("/v1/code-agents")).json()
        assert next(item for item in catalog["items"] if item["id"] == kind)["available"]
        conversation = (await client.post("/v1/amadeus/conversations")).json()
        root = f"/v1/amadeus/conversations/{conversation['id']}"
        await client.post(
            root + "/messages", json={"role": "user", "content": "核对目录", "expected_revision": 0}
        )
        response = await client.post(root + "/runs", json={"agent_id": kind})
        assert response.status_code == 200, response.text
        result = await wait_run(client, root, response.json()["run"]["id"])
        assert result["run"]["status"] == "completed", (
            result["run"]["error_message"],
            result["events"],
        )
        assert "已核对项目" in result["run"]["partial_text"]
        assert any(event["kind"] == "tool_call" for event in result["events"])
        assert any(event["kind"] == "tool_result" for event in result["events"])


def media_server(root):
    path = root / "media-tools.py"
    path.write_text("""import json, sys
for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    if method == "notifications/initialized": continue
    if method == "tools/list":
        result = {"tools":[{"name":"manifest", "inputSchema":{"type":"object","properties":{}}}]}
    elif method == "tools/call":
        assert request["params"]["name"] == "manifest"
        result = {"content":[{"type":"text","text":"fixture manifest"}]}
    else: result = {}
    print(json.dumps({"jsonrpc":"2.0","id":request["id"],"result":result}), flush=True)
""")
    return path


@pytest.mark.parametrize("kind", NATIVE)
async def test_native_acceptance_uses_task_tools_and_returns_structured_report(
    native_cli, kind, tmp_path
):
    schema = tmp_path / "schema.json"
    schema.write_text('{"type":"object"}')

    async def cancelled():
        return False

    result = await execute(
        kind,
        native_cli,
        tmp_path,
        schema,
        [sys.executable, str(media_server(tmp_path))],
        "Check task",
        cancelled,
    )
    assert result == {"summary": kind}


async def test_pi_and_opencode_profiles_exclude_personal_tools(tmp_path, native_cli, monkeypatch):
    home = tmp_path / "pi-config"
    home.mkdir()
    (home / "settings.json").write_text(
        json.dumps(
            {
                "defaultModel": "fixture",
                "extensions": ["evil"],
                "mcp": {"evil": {}},
                "retry": {"enabled": True},
            }
        )
    )
    (home / "auth.json").write_text("{}")
    monkeypatch.setenv("PI_CODING_AGENT_DIR", str(home))
    async with launch("pi", native_cli, tmp_path, {}) as (args, env):
        settings = json.loads((Path(env["PI_CODING_AGENT_DIR"]) / "settings.json").read_text())
        assert settings == {"defaultModel": "fixture", "retry": {"enabled": False}}
        assert "--no-extensions" in args and "--no-mcp" in args
        assert not any(key.startswith("FPL_SECRETS") for key in env)
    async with launch("opencode", native_cli, tmp_path, {}) as (_, env):
        config = json.loads(env["OPENCODE_CONFIG_CONTENT"])
        assert config["model"] == "fake/model"
        assert config["mcp"] == {} and config["plugin"] == []
        assert config["permission"] == {"*": "deny"}


def test_harness_imports_connection_rows_and_rejects_dynamic_provider_scripts(tmp_path):
    path = tmp_path / "cordis.patch.yml"
    path.write_text(
        '- id: llm-deepseek\n  config: {baseURL: "https://provider.invalid"}\n'
        '- insert: [{id: evil, name: "evil-plugin"}]\n'
    )
    assert dsh_connection_patches(tmp_path) == [
        {"id": "llm-deepseek", "config": {"baseURL": "https://provider.invalid"}}
    ]
    path.write_text('- id: llm-deepseek\n  config: {apiKey: !!js "process.env.SECRET"}\n')
    with pytest.raises(CliError, match="动态脚本"):
        dsh_connection_patches(tmp_path)


async def test_native_cancellation_reaps_the_process(native_cli, tmp_path):
    async def emit(_kind, _payload):
        pass

    task = asyncio.create_task(
        converse("opencode", native_cli, tmp_path, "", "SLOW_NATIVE", {}, emit)
    )
    for _ in range(100):
        if (tmp_path / "native-pid").is_file():
            break
        await asyncio.sleep(0.01)
    pid = int((tmp_path / "native-pid").read_text())
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_pi_extension_registers_only_task_tools_and_forwards_results(tmp_path):
    import subprocess

    node = shutil.which("node")
    if not node:
        pytest.skip("Node required for packaged CLI resources")
    source = Path(__file__).parents[1] / "backend/app/capabilities/agents/cli/pi_tools.mjs"
    config = {
        "mcpServers": {
            "acceptance_task": {
                "command": sys.executable,
                "args": [str(media_server(tmp_path))],
            }
        }
    }
    script = """const m = await import(process.argv[1]);
      const tools = [], events = {}; let active;
      await m.default({registerTool(t){tools.push(t);},on(n,f){events[n]=f;},
        setActiveTools(v){active=v;}});
      events.session_start();
      if (JSON.stringify(active) !== '["manifest"]') process.exit(1);
      const result = await tools[0].execute('call-1', {}, new AbortController().signal);
      if (result.content[0].text !== 'fixture manifest') process.exit(2);
      events.session_shutdown();
    """
    subprocess.run(
        [node, "--input-type=module", "-e", script, source.as_uri()],
        env={"FPL_CLI_MCP_CONFIG": json.dumps(config)},
        check=True,
        timeout=15,
    )


def test_harness_guard_denies_every_undeclared_tool():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node required for packaged CLI resources")
    import subprocess

    source = Path(__file__).parents[1] / "backend/app/capabilities/agents/cli/dsh_tools.mjs"
    script = """const m = await import(process.argv[1]); let guard;
      m.apply({tools:{guard(fn){guard=fn;}}});
      if (guard({name:'mcp__fpl__operations'}) !== undefined) process.exit(1);
      for (const name of ['bash','read_file','mcp__personal__read']) {
        if (!guard({name})) process.exit(2);
      }
    """
    subprocess.run(
        [node, "--input-type=module", "-e", script, source.as_uri()],
        env={"FPL_CLI_ALLOWED_TOOLS": '["mcp__fpl__operations"]'},
        check=True,
    )
