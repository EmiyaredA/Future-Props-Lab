"""macOS sandbox execution for per-conversation scripts and shell commands."""

from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import signal
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

from app.console.amadeus.files import read_file_bytes, work_root
from app.runtime.config import REPO_ROOT
from app.runtime.operation_receipts import OperationError

SCRIPT_TIMEOUT_SECONDS = 120


def _quote(value: Path) -> str:
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def _runner() -> tuple[Path, list[str], Path]:
    if getattr(sys, "frozen", False):
        executable = (
            Path(sys.executable).resolve().parent.parent / "fpl-script-runner" / "fpl-script-runner"
        )
        return executable, [], executable.parent
    executable = Path(sys.executable).resolve()
    entry = REPO_ROOT / "scripts" / "website" / "script_runner.py"
    return executable, [str(entry)], executable.parent


def sandbox_available() -> bool:
    sandbox = Path("/usr/bin/sandbox-exec")
    if sys.platform != "darwin" or not sandbox.is_file():
        return False
    try:
        probe = subprocess.run(
            [str(sandbox), "-p", "(version 1)(allow default)", "/usr/bin/true"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=3,
            check=False,
        )
        return probe.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


async def run_script(
    owner_user_id: str,
    conversation_id: str,
    arguments: dict,
    on_output: Callable[[str], None] | None = None,
) -> dict:
    sandbox = Path("/usr/bin/sandbox-exec")
    if sys.platform != "darwin" or not sandbox.is_file():
        raise OperationError("此系统不支持脚本沙箱", "sandbox_unavailable", 409)
    root = work_root(owner_user_id, conversation_id)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    (root / "tmp").mkdir(mode=0o700, exist_ok=True)
    kind = arguments.get("kind")
    if kind == "python":
        name = str(arguments.get("name", ""))
        script = read_file_bytes(owner_user_id, conversation_id, "scripts", name)
        expected = str(arguments.get("sha256", ""))
        if hashlib.sha256(script).hexdigest() != expected:
            raise OperationError("脚本已修改，请重新确认", "approval_conflict", 409)
        executable, extra, read_root = _runner()
        command = [str(executable), *extra, f"scripts/{name}"]
        script_input = script
        additional_read = [read_root]
        if extra:
            additional_read.append(Path(extra[0]))
    elif kind == "shell":
        command_text = arguments.get("command")
        if not isinstance(command_text, str) or not command_text or len(command_text) > 20_000:
            raise OperationError("Shell 命令无效")
        if hashlib.sha256(command_text.encode()).hexdigest() != arguments.get("sha256"):
            raise OperationError("命令已修改，请重新确认", "approval_conflict", 409)
        command = ["/bin/sh", "-c", command_text]
        additional_read = []
        script_input = None
    else:
        raise OperationError("脚本类型无效")
    media_bin = (
        Path(sys.executable).resolve().parent / "_internal" / "bin"
        if getattr(sys, "frozen", False)
        else Path(shutil.which("ffmpeg") or "/nonexistent").resolve().parent
    )
    media_tools = [media_bin / name for name in ("ffmpeg", "ffprobe")]
    read_paths = [root, Path(sys.prefix), Path(sys.base_prefix), *additional_read]
    if media_bin.is_dir():
        read_paths.append(media_bin)
    executable_paths = [Path(command[0]), *[tool for tool in media_tools if tool.is_file()]]
    read_ancestors = sorted(
        {parent for path in [*read_paths, *executable_paths] for parent in path.parents},
        key=str,
    )
    profile = "\n".join(
        [
            "(version 1)",
            "(allow default)",
            "(deny network*)",
            "(deny process-exec)",
            '(deny file-read* (subpath "/Users") (subpath "/private/var") '
            '(subpath "/private/tmp") (subpath "/Volumes") (subpath "/Network"))',
            "(deny file-write*)",
            "(allow file-read-metadata "
            + " ".join(f"(literal {_quote(path)})" for path in read_ancestors)
            + ")",
            "(allow file-read* "
            + " ".join(f"(subpath {_quote(path)})" for path in read_paths)
            + ")",
            f"(allow file-write* (subpath {_quote(root)}))",
            "(allow process-exec "
            + " ".join(f"(literal {_quote(path)})" for path in executable_paths)
            + ")",
        ]
    )
    env = {
        "PATH": f"{media_bin}:/usr/bin:/bin" if media_bin.is_dir() else "/usr/bin:/bin",
        "HOME": str(root),
        "TMPDIR": str(root / "tmp"),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
    }
    process = await asyncio.create_subprocess_exec(
        str(sandbox),
        "-p",
        profile,
        *command,
        cwd=root,
        env=env,
        stdin=asyncio.subprocess.PIPE if script_input is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,
    )
    if script_input is not None and process.stdin is not None:
        process.stdin.write(script_input)
        await process.stdin.drain()
        process.stdin.close()

    async def collect() -> tuple[bytes, bool]:
        chunks = bytearray()
        overflow = False
        while True:
            chunk = await process.stdout.read(65_536)
            if not chunk:
                break
            if len(chunks) + len(chunk) > 1024 * 1024:
                visible = chunk[: 1024 * 1024 - len(chunks)]
                chunks.extend(visible)
                if on_output is not None:
                    on_output(visible.decode(errors="replace"))
                overflow = True
                os.killpg(process.pid, signal.SIGKILL)
                break
            chunks.extend(chunk)
            if on_output is not None:
                on_output(chunk.decode(errors="replace"))
        await process.wait()
        return bytes(chunks), overflow

    try:
        output, truncated = await asyncio.wait_for(collect(), timeout=SCRIPT_TIMEOUT_SECONDS)
    except (TimeoutError, asyncio.CancelledError):
        os.killpg(process.pid, signal.SIGKILL)
        await process.wait()
        raise
    if process.returncode == 71 and b"sandbox_apply" in output:
        raise OperationError("macOS 脚本沙箱不可用", "sandbox_unavailable", 409)
    if process.returncode == -signal.SIGABRT and not output:
        raise OperationError("脚本运行器未能在沙箱内启动", "sandbox_unavailable", 409)
    return {
        "exit_code": process.returncode,
        "output": output.decode(errors="replace"),
        "truncated": truncated,
    }
