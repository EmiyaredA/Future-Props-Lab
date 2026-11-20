"""Real kernel sandbox and task SDK/CLI tests; no provider or production resources."""

import asyncio
import os
import sys
from pathlib import Path

import pytest
from future_props_lab import WaitingApproval, async_task_client, task_client
from future_props_lab.task import TaskConnection

from studio.host.agent_execution.cli.sandbox import ProcessSandbox, verify_sandbox
from studio.host.agent_execution.cli.tool_relay import ToolRelay
from studio.host.agent_execution.cli.transport import CliError
from studio.host.agent_execution.cli.workspace import RunWorkspace, workspace


async def silent(*_args):
    pass


def catalog():
    return [
        {
            "id": "visual.list_projects",
            "resource": "visual",
            "method": "GET",
            "path": "/v1/visual-workshop/projects",
            "parameters": [],
            "request_schema": {},
        },
        {
            "id": "visual.patch_project",
            "resource": "visual",
            "method": "PATCH",
            "path": "/v1/visual-workshop/projects/{project_id}",
            "parameters": [],
            "request_schema": {},
        },
    ]


@pytest.fixture
async def bridge():
    calls = []

    async def call(name, args):
        calls.append((name, args))
        if name == "operations":
            return {"items": catalog()}
        assert name == "call"
        if args["operation"] == "visual.patch_project":
            return {"waiting_approval": {"id": "approval", "arguments": args["arguments"]}}
        assert args["operation"] == "visual.list_projects"
        return {"status_code": 200, "result": {"items": []}}

    relay = ToolRelay([], call, silent)
    try:
        config = await relay.start()
        yield relay, config, calls
    finally:
        await relay.close()


async def test_task_sdk_named_methods_use_bridge_and_pause_on_writes(bridge):
    relay, config, calls = bridge
    env = config["mcpServers"]["fpl"]["env"]
    options = {"socket_path": env["FPL_TOOL_SOCKET"], "token": relay.token}

    def read_and_propose():
        with task_client(**options) as client:
            assert client.visual.list_projects().items == []
            with pytest.raises(WaitingApproval) as paused:
                client.visual.patch_project(project_id="one", body={"title": "proposal"})
            assert paused.value.action["id"] == "approval"

    await asyncio.to_thread(read_and_propose)
    async with async_task_client(**options) as client:
        assert (await client.visual.list_projects()).items == []
    writes = [args for name, args in calls if args.get("operation") == "visual.patch_project"]
    assert len(writes) == 1
    assert writes[0]["arguments"]["path_params"] == {"project_id": "one"}


async def test_task_sdk_rejects_unknown_routes_and_revoked_token(bridge):
    relay, config, _ = bridge
    env = config["mcpServers"]["fpl"]["env"]

    def request():
        connection = TaskConnection(socket_path=env["FPL_TOOL_SOCKET"], token="revoked")
        from future_props_lab import ApiError

        with pytest.raises(ApiError):
            connection.call("operations", {})

    await asyncio.to_thread(request)
    await relay.close()
    with pytest.raises(OSError):
        await asyncio.to_thread(request)


@pytest.fixture
async def isolated(tmp_path, bridge):
    if sys.platform != "darwin":
        pytest.skip("Real macOS kernel sandbox tests require Darwin")
    try:
        await verify_sandbox()
    except CliError as exc:
        pytest.skip(f"Sandbox unavailable in this test runner: {exc}")
    _, config, _ = bridge
    async with workspace(tmp_path / "runtime") as local:
        local.attach(config)
        yield local


async def test_scripts_use_real_cli_sdk_and_cannot_read_host(isolated, tmp_path):
    outside = tmp_path / "private-source.py"
    outside.write_text("do-not-disclose")
    credential = isolated.private / "credential.json"
    credential.write_text("not-a-real-secret")
    (isolated.root / "escape").symlink_to(outside)
    (isolated.root / "check.py").write_text(
        "from pathlib import Path\n"
        "import socket, subprocess\n"
        "from future_props_lab import task_client\n"
        f"for name in {list(map(str, [outside, credential, isolated.root / 'escape']))!r}:\n"
        " try: Path(name).read_bytes()\n"
        " except PermissionError: pass\n"
        " else: raise AssertionError('host read succeeded')\n"
        "try: socket.create_connection(('127.0.0.1', 9))\n"
        "except PermissionError: pass\n"
        "else: raise AssertionError('direct network succeeded')\n"
        "with task_client() as client: assert client.visual.list_projects().items == []\n"
        "Path('result.txt').write_text('scratch output')\n"
        "print('SDK_OK')\n"
    )
    result = await isolated.execute(
        {"command": "python check.py && fpl --task call visual.list_projects </dev/null"}
    )
    assert result["exit_code"] == 0, result
    assert "SDK_OK" in result["output"] and "[]" in result["output"]
    assert (isolated.root / "result.txt").read_text() == "scratch output"
    for command in (
        f"cat '{outside}'",
        f"printf x > '{outside}'",
        f"ls '{tmp_path}'",
        f"cat '{Path(__file__).resolve()}'",
    ):
        result = await isolated.execute({"command": command})
        assert result["exit_code"] != 0, result
    assert outside.read_text() == "do-not-disclose"
    alias = Path("/System/Volumes/Data") / str(outside).lstrip("/")
    if alias.exists():
        assert (await isolated.execute({"command": f"cat '{alias}'"}))["exit_code"] != 0
    result = await isolated.execute({"command": f"ln '{outside}' hardlink && cat hardlink"})
    assert result["exit_code"] != 0


async def test_saving_is_explicit_and_uses_existing_approval(isolated):
    (isolated.root / "out.md").write_text("output")
    proposed = []

    async def propose(name, arguments):
        proposed.append((name, arguments))
        return {"waiting_approval": {"id": "save"}}

    result = await isolated.save({"path": "out.md", "name": "saved.md"}, propose)
    assert "waiting_approval" in result
    assert proposed == [("write_file", {"name": "saved.md", "content": "output"})]
    for path in ("../credential.json", "/etc/passwd"):
        with pytest.raises(CliError):
            await isolated.save({"path": path, "name": "bad"}, propose)


async def test_timeout_output_limit_and_cancellation_reap_children(isolated):
    result = await isolated.execute({"command": "python -c 'print(\"x\"*1100000)'"})
    assert result["truncated"]
    assert len(result["output"].encode()) == 1024 * 1024
    with pytest.raises(TimeoutError):
        await isolated.execute({"command": "sleep 30", "timeout": 1})
    task = asyncio.create_task(
        isolated.execute({"command": "sleep 30 & echo $! > child.pid; wait"})
    )
    for _ in range(50):
        if (isolated.root / "child.pid").exists():
            break
        await asyncio.sleep(0.02)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    pid = int((isolated.root / "child.pid").read_text())
    for _ in range(50):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        await asyncio.sleep(0.02)
    else:
        pytest.fail("Workspace child survived cancellation")


async def test_workspace_cleans_all_private_files(tmp_path):
    if sys.platform != "darwin":
        pytest.skip("Darwin required")
    try:
        await verify_sandbox()
    except CliError:
        pytest.skip("Sandbox unavailable")
    async with workspace(tmp_path / "runtime") as local:
        root = local.private
        (local.root / "discard.txt").write_text("temporary")
    assert not root.exists()


def test_unsupported_platform_refuses_execution(monkeypatch):
    monkeypatch.setattr(sys, "platform", "unsupported")
    with pytest.raises(CliError, match="拒绝非隔离"):
        ProcessSandbox().command(["/usr/bin/true"])


def test_workspace_cwd_rejects_parent_absolute_and_symlink(tmp_path):
    local = RunWorkspace(tmp_path / "private", tmp_path / "runtime")
    (local.root / "link").symlink_to(tmp_path, target_is_directory=True)
    for path in ("..", str(tmp_path), "link"):
        with pytest.raises(CliError):
            local.path(path, directory=True)
