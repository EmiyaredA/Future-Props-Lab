"""CLI transport security, event decoding and cancellation with disposable fake processes."""

import asyncio
import json
import os
import sys
from pathlib import Path

import pytest

from app.apps.visual_workshop.acceptance.execution.reports import validate_report
from app.apps.visual_workshop.acceptance.execution.task_tools import (
    MediaTools,
    file_digest,
    safe_file,
)
from app.capabilities.agents.cli.process import CliError, command, environment, execute, probe


def fake_cli(root, body):
    path = root / "fake-agent"
    path.write_text(f"#!{sys.executable}\n" + body)
    path.chmod(0o700)
    return str(path)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["codex", "claude-code"])
async def test_native_events_and_fixed_structured_output(tmp_path, kind, monkeypatch):
    monkeypatch.setenv("FPL_SECRETS_KEY", "must-not-reach-child")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-reach-child")
    schema = tmp_path / "schema.json"
    schema.write_text("{}")
    body = """import sys,json,os
assert not any(k.startswith("FPL_") for k in os.environ)
assert "OPENAI_API_KEY" not in os.environ
assert sys.stdin.read() == "task prompt"
if "exec" in sys.argv:
    from pathlib import Path
    Path(sys.argv[sys.argv.index("-o")+1]).write_text(json.dumps({"summary":"codex"}))
    print(json.dumps({"type":"thread.started","thread_id":"fake"}))
    print(json.dumps({"type":"turn.completed","usage":{}}))
else:
    print(json.dumps({"type":"system","subtype":"init"}))
    print(json.dumps({"type":"result","subtype":"success","structured_output":{"summary":"claude-code"}}))
"""
    executable = fake_cli(tmp_path, body)

    async def cancelled():
        return False

    result = await execute(
        kind, executable, tmp_path, schema, [sys.executable, "tools.py"], "task prompt", cancelled
    )
    assert result == {"summary": kind}
    args = command(kind, executable, tmp_path, schema, [sys.executable, "tools.py"])
    combined = " ".join(args)
    if kind == "codex":
        assert "shell_tool=false" in combined and "--ignore-user-config" in args
        assert "read-only" in combined and "web_search" in combined
    else:
        assert args[args.index("--tools") + 1] == "" and "--strict-mcp-config" in args
        assert "--restricted" in args and "--permission-prompts" in args


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,body",
    [
        (
            "codex",
            'import json\nprint(json.dumps({"type":"turn.failed","error":{"message":"failure"}}))',
        ),
        (
            "claude-code",
            'import json\nprint(json.dumps({"type":"result",'
            '"subtype":"error_max_turns","is_error":True}))',
        ),
        ("claude-code", 'print("invalid event")'),
    ],
)
async def test_invalid_or_error_events_fail(tmp_path, kind, body):
    schema = tmp_path / "schema.json"
    schema.write_text("{}")

    async def cancelled():
        return False

    with pytest.raises((CliError, ValueError)):
        await execute(
            kind, fake_cli(tmp_path, body), tmp_path, schema, ["tools"], "prompt", cancelled
        )


@pytest.mark.asyncio
async def test_cancel_terminates_child_and_probe_status(tmp_path):
    schema = tmp_path / "schema.json"
    schema.write_text("{}")
    executable = fake_cli(
        tmp_path,
        """import sys,time,os
from pathlib import Path
if "--version" in sys.argv:
    print("codex-cli 0.163.0")
elif "login" in sys.argv:
    sys.exit(1)
else:
    Path("pid").write_text(str(os.getpid()))
    time.sleep(60)
""",
    )
    assert not (await probe("codex", executable))[0]
    assert not (await probe("codex", "/does/not/exist"))[0]

    async def cancelled():
        return (tmp_path / "pid").exists()

    with pytest.raises(CliError, match="取消"):
        await execute("codex", executable, tmp_path, schema, ["tools"], "prompt", cancelled)
    pid = int((tmp_path / "pid").read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_report_requires_actual_read_evidence_and_valid_intervals():
    criteria = [{"id": "identity", "method": "ai"}]
    report = {
        "summary": "summary",
        "limitations": [],
        "findings": [
            {
                "criterion_id": "identity",
                "suggestion": "pending",
                "explanation": "insufficient evidence",
                "evidence_ids": ["read"],
                "start_ms": None,
                "end_ms": None,
            }
        ],
    }
    assert (
        validate_report(report, criteria, [{"id": "read"}], 1000).findings[0].suggestion
        == "pending"
    )
    with pytest.raises(ValueError, match="未读取"):
        validate_report(report, criteria, [], 1000)
    report["findings"][0].update(start_ms=0, end_ms=1200)
    with pytest.raises(ValueError, match="区间"):
        validate_report(report, criteria, [{"id": "read"}], 1000)


@pytest.mark.asyncio
async def test_media_tools_reject_escape_mutation_and_sample_budget(tmp_path, monkeypatch):
    from PIL import Image

    source = tmp_path / "image.png"
    Image.new("RGB", (32, 32), "red").save(source)
    item = {
        "id": "evidence",
        "file": "image.png",
        "sha256": file_digest(source),
        "source_asset_id": "source",
        "position_ms": None,
    }
    (tmp_path / "manifest.json").write_text(
        json.dumps({"task": {}, "media": [], "evidence": [item]})
    )
    tools = MediaTools(tmp_path)
    assert (await tools.image("evidence"))[1].type == "image"
    assert json.loads((tmp_path / "receipts.json").read_text())["read_ids"] == ["evidence"]
    with pytest.raises(ValueError, match="文件标识"):
        safe_file(tmp_path, "../elsewhere")
    (tmp_path / "link").symlink_to(source)
    with pytest.raises(ValueError):
        safe_file(tmp_path, "link")
    source.write_bytes(b"changed")
    with pytest.raises(ValueError, match="已变化"):
        await tools.image("evidence")
    for count in (0, 13):
        with pytest.raises(ValueError, match="最多"):
            await tools.sample("source", 0, 10, count)
    tools.extra = [item] * 24
    with pytest.raises(ValueError, match="最多"):
        await tools.sample("source", 0, 10, 1)
    monkeypatch.setenv("FPL_ANY_SECRET", "secret")
    assert "FPL_ANY_SECRET" not in environment()


@pytest.mark.asyncio
async def test_timeout_terminates_native_process(tmp_path, monkeypatch):
    from app.capabilities.agents.cli import process

    monkeypatch.setattr(process, "EXECUTION_TIMEOUT_SECONDS", 0.05)
    schema = tmp_path / "schema.json"
    schema.write_text("{}")
    executable = fake_cli(tmp_path, "import time\ntime.sleep(60)")

    async def cancelled():
        return False

    with pytest.raises(CliError, match="十五分钟"):
        await execute("codex", executable, tmp_path, schema, ["tools"], "prompt", cancelled)


@pytest.mark.asyncio
async def test_parent_death_watchdog_stops_executor():
    import subprocess

    from app.capabilities.agents.cli import watchdog

    result = await asyncio.to_thread(
        subprocess.run,
        [
            sys.executable,
            "-c",
            "from app.capabilities.agents.cli.watchdog import supervise; "
            "raise SystemExit(supervise(99999999, "
            "[__import__('sys').executable, '-c', 'import time; time.sleep(60)']))",
        ],
        env={**environment(), "PYTHONPATH": str(Path(watchdog.__file__).resolve().parents[4])},
        timeout=5,
        capture_output=True,
    )
    assert result.returncode != 0
    assert b"Traceback" not in result.stderr


@pytest.mark.asyncio
async def test_independent_media_entry_exposes_only_scoped_mcp_tools(tmp_path):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    from PIL import Image

    image = tmp_path / "reference.png"
    Image.new("RGB", (24, 24), "green").save(image)
    (tmp_path / "manifest.json").write_text(
        json.dumps(
            {
                "task": {"prompt": "data"},
                "media": [],
                "evidence": [
                    {
                        "id": "e",
                        "file": image.name,
                        "source_asset_id": "source",
                        "position_ms": None,
                        "sha256": file_digest(image),
                    }
                ],
            }
        )
    )
    entry = Path(__file__).resolve().parents[1] / "desktop/backend/acceptance_tools_entry.py"
    parameters = StdioServerParameters(
        command=sys.executable,
        args=[str(entry), str(tmp_path)],
        env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PYTHONDONTWRITEBYTECODE": "1"},
    )
    async with asyncio.timeout(10), stdio_client(parameters) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            assert {tool.name for tool in (await session.list_tools()).tools} == {
                "manifest",
                "image",
                "sample",
            }
            result = await session.call_tool("image", {"evidence_id": "e"})
            assert not result.is_error and any(item.type == "image" for item in result.content)
            denied = await session.call_tool("image", {"evidence_id": "../outside"})
            assert denied.is_error
