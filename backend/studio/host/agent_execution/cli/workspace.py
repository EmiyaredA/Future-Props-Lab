"""One disposable Amadeus workspace, private CLI profiles and bounded script execution."""

import asyncio
import hashlib
import json
import os
import signal
import stat
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from studio.contracts.amadeus.tools import definition

from .sandbox import (
    ProcessSandbox, clean_script_environment, program_command, program_paths, verify_sandbox,
)
from .transport import CliError, close_transport
from .workspace_runtime import prepare_runtime

WORKSPACE_TOOLS = [
    definition(
        "execute_workspace",
        "Execute shell/Python/FPL SDK scripts in this run's temporary "
        "workspace. Only workspace files are accessible; project calls use task_client() "
        "or fpl --task. A proposed write pauses the run; never replay the script.",
        {
            "command": {"type": "string", "minLength": 1, "maxLength": 20000},
            "cwd": {"type": "string", "maxLength": 500},
            "timeout": {"type": "integer", "minimum": 1, "maximum": 120},
        },
        ("command",),
    ),
    definition(
        "save_workspace_file",
        "Propose saving a UTF-8 workspace file into conversation "
        "outputs. Scratch files disappear after this run; saving requires approval.",
        {
            "path": {"type": "string", "minLength": 1, "maxLength": 500},
            "name": {"type": "string", "minLength": 1, "maxLength": 200},
            "expected_sha256": {"type": "string"},
        },
        ("path", "name"),
    ),
]
MAX_OUTPUT = 1024 * 1024
MAX_WORKSPACE = 512 * 1024 * 1024


def copy_regular(source, destination, *, required=False):
    source, destination = Path(source), Path(destination)
    try:
        fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        if required:
            raise CliError("CLI 专用登录不可用") from None
        return False
    with os.fdopen(fd, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_OUTPUT:
            raise CliError("CLI 认证文件不安全或过大")
        data = handle.read(MAX_OUTPUT + 1)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination.write_bytes(data)
    destination.chmod(0o600)
    return True


class RunWorkspace:
    def __init__(self, private, runtime):
        self.private, self.runtime = Path(private).resolve(), Path(runtime).resolve()
        self.root = self.private / "work"
        self.root.mkdir(mode=0o700, parents=True)
        (self.root / "tmp").mkdir(mode=0o700)
        (self.private / "home").mkdir(mode=0o700)
        (self.private / "tmp").mkdir(mode=0o700)
        self.socket, self.token = None, None
        self.lock = asyncio.Lock()
        self.closed = False
        self.sockets = []

    def attach(self, config, *, task=True):
        server = config["mcpServers"]["fpl"]
        self.sockets.append(Path(server["env"]["FPL_TOOL_SOCKET"]).resolve())
        if task:
            self.socket = Path(server["env"]["FPL_TOOL_SOCKET"]).resolve()
            self.token = server["env"]["FPL_TOOL_TOKEN"]
        server["command"] = str(self.runtime / "bin" / "fpl")
        server["args"] = ["mcp", "relay"]
        server["env"]["PATH"] = f"{self.runtime / 'bin'}:/usr/bin:/bin"

    def environment(self, env):
        return {
            **env,
            "HOME": str(self.private / "home"),
            "TMPDIR": str(self.private / "tmp"),
            "XDG_CACHE_HOME": str(self.private / "cache"),
            "XDG_DATA_HOME": str(self.private / "data"),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONNOUSERSITE": "1",
        }

    def command(self, args, *, read=()):
        policy = ProcessSandbox(
            read=[
                self.runtime,
                Path(sys.base_prefix),
                *program_paths(args[0]),
                *self.sockets,
                *read,
            ],
            write=[self.private],
            sockets=self.sockets,
            network=True,
        )
        return policy.command(program_command(args))

    def codex_profile(self, original):
        from .codex_profile import profile_environment

        profile_environment(original)
        profile = self.private / "codex"
        profile.mkdir(mode=0o700)
        copy_regular(Path(original) / "auth.json", profile / "auth.json", required=True)
        return profile

    async def claude_environment(self, env):
        home = Path(env.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
        profile = self.private / "claude"
        profile.mkdir(mode=0o700)
        if not copy_regular(home / ".credentials.json", profile / ".credentials.json"):
            # macOS Claude stores OAuth in the keychain. Only the trusted host reads it;
            # the model CLI and generated scripts never receive keychain access.
            service = "Claude Code-credentials"
            if env.get("CLAUDE_CONFIG_DIR"):
                service += "-" + hashlib.sha256(str(home).encode()).hexdigest()[:8]
            process = await asyncio.create_subprocess_exec(
                "/usr/bin/security",
                "find-generic-password",
                "-s",
                service,
                "-w",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                data, _ = await asyncio.wait_for(process.communicate(), 5)
                if process.returncode or not data or len(data) > MAX_OUTPUT:
                    raise CliError("无法为 Claude Code 建立隔离登录快照，请检查专用登录")
                json.loads(data)
                path = profile / ".credentials.json"
                path.write_bytes(data)
                path.chmod(0o600)
            finally:
                # Reap background children even if the shell itself already exited.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                await close_transport(process)
        return {**self.environment(env), "CLAUDE_CONFIG_DIR": str(profile)}

    def path(self, value, *, directory=False):
        if not isinstance(value, str) or not value or "\x00" in value:
            raise CliError("临时工作区路径无效")
        relative = Path(value)
        if relative.is_absolute() or ".." in relative.parts:
            raise CliError("路径只能位于本轮临时工作区")
        path = self.root.joinpath(relative)
        for parent in [path, *path.parents]:
            if parent == self.root:
                break
            if parent.is_symlink():
                raise CliError("临时工作区路径不能经过符号链接")
        path = path.resolve(strict=True)
        if not path.is_relative_to(self.root) or directory and not path.is_dir():
            raise CliError("临时工作区路径无效")
        return path

    async def execute(self, arguments):
        from jsonschema import validate

        validate(arguments, WORKSPACE_TOOLS[0]["inputSchema"])
        async with self.lock:
            if self.closed or not self.socket:
                raise CliError("临时工作区已关闭")
            cwd = self.path(arguments.get("cwd", "."), directory=True)
            policy = ProcessSandbox(
                read=[self.runtime, Path(sys.base_prefix)],
                write=[self.root],
                sockets=[self.socket],
                script=True,
            )
            env = clean_script_environment(self.root, self.runtime, self.socket, self.token)
            process = await asyncio.create_subprocess_exec(
                *policy.command(["/bin/bash", "--noprofile", "--norc", "-c", arguments["command"]]),
                cwd=cwd,
                env=env,
                start_new_session=True,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            async def collect():
                output = bytearray()
                while chunk := await process.stdout.read(65536):
                    output.extend(chunk)
                    if len(output) > MAX_OUTPUT:
                        return bytes(output[:MAX_OUTPUT]), True
                await process.wait()
                return bytes(output), False

            async def quota():
                while True:
                    size = sum(
                        p.lstat().st_size for p in self.root.rglob("*") if not p.is_symlink()
                    )
                    if size > MAX_WORKSPACE:
                        raise CliError("本轮临时文件超过 512 MiB")
                    await asyncio.sleep(0.2)

            collecting, checking = asyncio.create_task(collect()), asyncio.create_task(quota())
            try:
                async with asyncio.timeout(arguments.get("timeout", 120)):
                    done, _ = await asyncio.wait(
                        (collecting, checking), return_when=asyncio.FIRST_COMPLETED
                    )
                    if checking in done:
                        await checking
                    output, truncated = await collecting
                if b"sandbox_apply:" in output:
                    raise CliError("脚本系统沙箱不可用；拒绝非隔离运行")
                return {
                    "exit_code": process.returncode,
                    "output": output.decode(errors="replace"),
                    "truncated": truncated,
                }
            finally:
                for task in (collecting, checking):
                    task.cancel()
                await asyncio.gather(collecting, checking, return_exceptions=True)
                await close_transport(process)

    async def save(self, arguments, call):
        from jsonschema import validate

        validate(arguments, WORKSPACE_TOOLS[1]["inputSchema"])
        path = self.path(arguments["path"])
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as handle:
            if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                raise CliError("只可保存普通 UTF-8 文件")
            content = handle.read(256 * 1024 + 1)
        if len(content) > 256 * 1024:
            raise CliError("显式保存的文本文件不能超过 256 KiB")
        return await call(
            "write_file",
            {
                "name": arguments["name"],
                "content": content.decode(),
                **(
                    {"expected_sha256": arguments["expected_sha256"]}
                    if "expected_sha256" in arguments
                    else {}
                ),
            },
        )


@asynccontextmanager
async def workspace(runtime_path):
    await verify_sandbox()
    runtime = await asyncio.to_thread(prepare_runtime, runtime_path)
    with TemporaryDirectory(prefix="fpl-amadeus-") as directory:
        instance = RunWorkspace(directory, runtime)
        try:
            yield instance
        finally:
            instance.closed = True
