"""Deterministic native CLI fixture; never submits a provider request."""

import json
import os
import subprocess
import sys
import time
from pathlib import Path


def send(value):
    print(json.dumps(value), flush=True)


if "--version" in sys.argv:
    print("fake-native 9.9.9")
    raise SystemExit
if sys.argv[1:4] == ["--pure", "auth", "list"]:
    assert os.environ["OPENCODE_DISABLE_MODELS_FETCH"] == "true"
    print("Credentials", flush=True)
    time.sleep(0.1)
    print("1 credential")
    raise SystemExit
if sys.argv[1:3] == ["auth", "check"]:
    assert sys.argv[3:] == ["--json", "--no-refresh", "--provider", "fixture"]
    raise SystemExit
assert "FPL_SECRETS_KEY" not in os.environ
assert "FPL_STUDIO_TOKEN" not in os.environ
assert "OPENAI_API_KEY" not in os.environ
if sys.argv[1:3] == ["debug", "config"]:
    send({"model": "fake/model", "mcp": {"personal": {}}, "plugin": ["personal-plugin"]})
    raise SystemExit


def call_server(server, report=False):
    child = subprocess.Popen(
        [server["command"], *server.get("args", [])],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        env={"PATH": os.environ.get("PATH", ""), **server.get("env", {})},
    )
    try:
        for identity, method, params in [
            (1, "initialize", {}),
            (2, "tools/list", {}),
            (3, "tools/call", {"name": "manifest" if report else "operations", "arguments": {}}),
        ]:
            child.stdin.write(
                json.dumps({"jsonrpc": "2.0", "id": identity, "method": method, "params": params})
                + "\n"
            )
            child.stdin.flush()
            result = json.loads(child.stdout.readline())
            assert "result" in result and not result["result"].get("isError"), result
    finally:
        child.stdin.close()
        child.wait(timeout=10)


if "run" in sys.argv:
    config = json.loads(os.environ["OPENCODE_CONFIG_CONTENT"])
    assert config["plugin"] == [] and config["permission"]["*"] == "deny"
    assert set(config["mcp"]) <= {"fpl", "acceptance_task"}
    assert os.environ["OPENCODE_DISABLE_PROJECT_CONFIG"] == "true"
    assert "--pure" in sys.argv
    prompt = sys.stdin.read()
    report = "Return only a JSON object matching this schema" in prompt
    if "SLOW_NATIVE" in prompt:
        send({"type": "text", "part": {"text": str(os.getpid())}})
        time.sleep(60)
    if "BAD_NATIVE" in prompt:
        print("invalid-json")
        raise SystemExit
    server = next(iter(config["mcp"].values()))
    call_server(
        {
            "command": server["command"][0],
            "args": server["command"][1:],
            "env": server["environment"],
        },
        report=report,
    )
    text = json.dumps({"summary": "opencode"}) if report else "假 OpenCode 已核对项目"
    send({"type": "text", "part": {"text": text}})
    send({"type": "step_finish", "part": {"reason": "stop"}})
elif "--mode" in sys.argv:
    for flag in (
        "--no-tools",
        "--no-mcp",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--no-session",
    ):
        assert flag in sys.argv
    assert Path(sys.argv[sys.argv.index("--extension") + 1]).name == "pi_tools.mjs"
    config = json.loads(os.environ["FPL_CLI_MCP_CONFIG"])
    for line in sys.stdin:
        value = json.loads(line)
        if value.get("type") == "prompt":
            report = "Return only a JSON object matching this schema" in value["message"]
            call_server(next(iter(config["mcpServers"].values())), report=report)
            text = json.dumps({"summary": "pi"}) if report else "假 Pi 已核对项目"
            send(
                {
                    "type": "response",
                    "command": "prompt",
                    "success": True,
                    "data": {"disposition": "started"},
                }
            )
            send(
                {
                    "type": "message_update",
                    "assistantMessageEvent": {"type": "text_delta", "delta": text},
                }
            )
            send({"type": "agent_settled", "aborted": False})
            break
elif "--profile" in sys.argv:
    assert os.environ["DSH_PERMISSION_MODE"] == "read-only"
    assert Path(os.environ["DSH_HOME"]).name.startswith("fpl-cli-")
    assert Path(sys.argv[sys.argv.index("--patch") + 1]).is_file()
    server = None
    prompt_id = None
    report = False
    for line in sys.stdin:
        value = json.loads(line)
        method = value.get("method")
        if method == "initialize":
            send({"id": value["id"], "result": {"protocolVersion": 1}})
        elif method == "session/new":
            server = value["params"]["mcpServers"][0]
            send({"id": value["id"], "result": {"sessionId": "native-session"}})
        elif method == "session/prompt":
            prompt_id = value["id"]
            report = (
                "Return only a JSON object matching this schema"
                in value["params"]["prompt"][0]["text"]
            )
            send(
                {
                    "id": "forbidden-file",
                    "method": "fs/read_text_file",
                    "params": {"path": "/private/fixture-secret"},
                }
            )
        elif value.get("id") == "forbidden-file":
            assert value.get("error", {}).get("code") == -32601
            server["env"] = {entry["name"]: entry["value"] for entry in server["env"]}
            call_server(server, report=report)
            text = json.dumps({"summary": "dsh"}) if report else "假 Harness 已核对项目"
            send(
                {
                    "method": "session/update",
                    "params": {
                        "sessionId": "native-session",
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": {"type": "text", "text": text},
                        },
                    },
                }
            )
            send({"id": prompt_id, "result": {"stopReason": "end_turn"}})
        elif method == "session/close":
            send({"id": value["id"], "result": {}})
            break
